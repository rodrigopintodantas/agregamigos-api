const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  proto,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const { normalizarOpcoesBotoes } = require("../utils/modelo-mensagem-botoes");
const { anexarCapturaRespostas } = require("./whatsapp-captura-respostas-campanha");
const { persistirEstadoCanal, formatarNumeroCanal } = require("./whatsapp-canal-db");

function normalizarNumeroBrasil(numero) {
  let digits = String(numero || "").replace(/\D/g, "");
  if (!digits) return "";

  digits = digits.replace(/^00+/, "");

  const matchComOperadora = digits.match(/^0\d{2}(\d{10,11})$/);
  if (matchComOperadora?.[1]) {
    digits = matchComOperadora[1];
  } else {
    digits = digits.replace(/^0+/, "");
  }

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }

  if (digits.length === 8 || digits.length === 9) {
    digits = `61${digits}`;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

function extrairDigitosUsuarioJidWhatsapp(jid) {
  const user = String(jid || "").split("@")[0] || "";
  if (!user) return "";
  const semAgente = user.includes(":") ? String(user.split(":")[0] || "") : user;
  return semAgente.replace(/\D/g, "");
}

function listarEntradasAuth(pasta) {
  try {
    return fs.readdirSync(pasta);
  } catch {
    return [];
  }
}

/**
 * Pasta de auth por canal: `.baileys_auth/candidato_{id}/canal_{canalId}/`.
 * Migra credenciais legadas (arquivos soltos em `candidato_{id}/`) para o primeiro canal.
 */
function resolverPastaAuthBaileys(candidatoId, canalId) {
  const cid = Number(candidatoId);
  const kid = Number(canalId);
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new Error("candidato_id invalido para pasta de auth do WhatsApp.");
  }
  if (!Number.isInteger(kid) || kid <= 0) {
    throw new Error("canal_id invalido para pasta de auth do WhatsApp.");
  }

  const root = path.join(process.cwd(), ".baileys_auth");
  const candidatoDir = path.join(root, `candidato_${cid}`);
  const dest = path.join(candidatoDir, `canal_${kid}`);

  fs.mkdirSync(dest, { recursive: true });

  const legacyCreds = path.join(candidatoDir, "creds.json");
  const destCreds = path.join(dest, "creds.json");
  if (fs.existsSync(legacyCreds) && !fs.existsSync(destCreds)) {
    const entries = listarEntradasAuth(candidatoDir);
    const hasCanalSubdirs = entries.some((e) => e.startsWith("canal_"));
    if (!hasCanalSubdirs) {
      for (const name of entries) {
        if (name.startsWith("canal_")) continue;
        const from = path.join(candidatoDir, name);
        let st;
        try {
          st = fs.statSync(from);
        } catch {
          continue;
        }
        if (st.isFile() || st.isDirectory()) {
          const to = path.join(dest, name);
          if (!fs.existsSync(to)) {
            fs.renameSync(from, to);
          }
        }
      }
    }
  }

  if (cid === 1) {
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      entries = [];
    }
    const hasScoped = entries.some((e) => e.startsWith("candidato_"));
    const hasCredsAtRoot = entries.includes("creds.json");
    if (!hasScoped && hasCredsAtRoot && !fs.existsSync(destCreds)) {
      for (const name of entries) {
        if (name.startsWith("candidato_")) continue;
        const from = path.join(root, name);
        let st;
        try {
          st = fs.statSync(from);
        } catch {
          continue;
        }
        if (st.isFile() || st.isDirectory()) {
          const to = path.join(dest, name);
          if (!fs.existsSync(to)) {
            fs.renameSync(from, to);
          }
        }
      }
    }
  }

  return dest;
}

function limparArquivosAuthCanal(candidatoId, canalId) {
  let folder;
  try {
    folder = resolverPastaAuthBaileys(candidatoId, canalId);
  } catch {
    return;
  }
  if (!fs.existsSync(folder)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = path.join(folder, name);
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  }
}

class WhatsappPorCanal {
  constructor(canalId, candidatoId, nomeCanal = "Canal") {
    this.canalId = Number(canalId);
    this.candidatoId = Number(candidatoId);
    this.nomeCanal = String(nomeCanal || "Canal").trim() || "Canal";
    this.sock = null;
    this.conectando = false;
    this.estado = {
      conectado: false,
      status: "desconectado",
      numero: null,
      nomePerfil: this.nomeCanal,
      qrCode: null,
      candidato_id: this.candidatoId,
      whatsapp_canal_id: this.canalId,
      ultimaAtualizacao: new Date().toISOString(),
    };
  }

  getStatus() {
    return { ...this.estado };
  }

  async atualizarEstado(parcial) {
    this.estado = {
      ...this.estado,
      ...parcial,
      candidato_id: this.candidatoId,
      whatsapp_canal_id: this.canalId,
      ultimaAtualizacao: new Date().toISOString(),
    };
    try {
      await persistirEstadoCanal(this.canalId, this.estado);
    } catch (err) {
      console.error("[whatsapp-baileys] Falha ao persistir canal:", err?.message || err);
    }
  }

  async connect(nomePerfil) {
    const perfil = String(nomePerfil || this.nomeCanal || "Canal").trim() || this.nomeCanal;
    if (this.sock || this.conectando) {
      return this.getStatus();
    }

    this.conectando = true;
    await this.atualizarEstado({
      status: "conectando",
      conectado: false,
      nomePerfil: perfil,
      qrCode: null,
    });

    const authFolder = resolverPastaAuthBaileys(this.candidatoId, this.canalId);
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      syncFullHistory: false,
    });

    socket.ev.on("creds.update", saveCreds);
    anexarCapturaRespostas(socket, this.candidatoId, this.canalId);

    socket.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        const qrCode = await QRCode.toDataURL(qr);
        await this.atualizarEstado({
          status: "aguardando_qr",
          conectado: false,
          qrCode,
        });
      }

      if (connection === "open") {
        const user = socket.user?.id ? String(socket.user.id).split(":")[0] : null;
        await this.atualizarEstado({
          status: "conectado",
          conectado: true,
          numero: formatarNumeroCanal(user) || user,
          qrCode: null,
        });
        this.conectando = false;
      }

      if (connection === "close") {
        const reason = Number(lastDisconnect?.error?.output?.statusCode || 0);
        const loggedOut = reason === DisconnectReason.loggedOut;
        this.sock = null;
        this.conectando = false;
        await this.atualizarEstado({
          status: loggedOut ? "desconectado" : "reconectando",
          conectado: false,
          numero: null,
        });

        if (!loggedOut) {
          await this.connect(this.estado.nomePerfil || perfil);
        }
      }
    });

    this.sock = socket;
    this.conectando = false;
    return this.getStatus();
  }

  async disconnect() {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
    }
    this.conectando = false;
    await this.atualizarEstado({
      conectado: false,
      status: "desconectado",
      numero: null,
      qrCode: null,
    });
    return this.getStatus();
  }

  async trocarTelefone(nomePerfil) {
    await this.disconnect();
    limparArquivosAuthCanal(this.candidatoId, this.canalId);
    return this.connect(nomePerfil || this.nomeCanal);
  }

  async sendText(numero, mensagem, opcoesBotoes = null) {
    if (!this.sock || !this.estado.conectado) {
      throw new Error("Canal WhatsApp nao conectado.");
    }
    const digits = normalizarNumeroBrasil(numero);
    if (!digits) throw new Error("Numero de destino invalido.");
    const jidDigitado = `${digits}@s.whatsapp.net`;
    const existe = await this.sock.onWhatsApp(jidDigitado);
    if (!Array.isArray(existe) || !existe.length || !existe[0]?.exists) {
      throw new Error("Numero nao encontrado no WhatsApp.");
    }
    const jidResolvido = String(existe[0]?.jid || jidDigitado);
    const digitosNoJid = extrairDigitosUsuarioJidWhatsapp(jidResolvido);
    const whatsappMatch =
      digitosNoJid && digitosNoJid.length >= 11 ? digitosNoJid : digits;

    const texto = String(mensagem || "").trim();
    if (!texto) {
      throw new Error("Mensagem vazia para envio.");
    }

    const botoes = normalizarOpcoesBotoes(opcoesBotoes);
    let messageId;
    let remoteJid = jidResolvido;

    if (botoes.length >= 2) {
      const buttons = botoes.map((label, idx) => ({
        buttonId: `mdl_${idx}_${Date.now()}`,
        buttonText: { displayText: label },
        type: proto.Message.ButtonsMessage.Button.Type.RESPONSE,
      }));
      const waMessage = {
        buttonsMessage: {
          contentText: texto,
          footerText: "",
          buttons,
          headerType: proto.Message.ButtonsMessage.HeaderType.EMPTY,
        },
      };
      messageId = generateMessageIDV2(this.sock.user?.id);
      await this.sock.relayMessage(jidResolvido, waMessage, { messageId });
    } else {
      const resultado = await this.sock.sendMessage(jidResolvido, { text: texto });
      if (!resultado?.key?.id || !resultado?.key?.remoteJid) {
        throw new Error("WhatsApp nao confirmou o envio da mensagem.");
      }
      messageId = resultado.key.id;
      remoteJid = resultado.key.remoteJid;
    }

    return {
      numeroNormalizado: digits,
      whatsappMatch,
      jidDigitado,
      jidResolvido,
      messageId,
      remoteJid,
    };
  }
}

class WhatsappBaileysManager {
  constructor() {
    /** @type {Map<number, WhatsappPorCanal>} */
    this.instances = new Map();
  }

  parseCanalId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("whatsapp_canal_id invalido.");
    }
    return id;
  }

  parseCandidatoId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("candidato_id invalido.");
    }
    return id;
  }

  getOrCreate(canalId, candidatoId, nomeCanal) {
    const kid = this.parseCanalId(canalId);
    const cid = this.parseCandidatoId(candidatoId);
    if (!this.instances.has(kid)) {
      this.instances.set(kid, new WhatsappPorCanal(kid, cid, nomeCanal));
    }
    return this.instances.get(kid);
  }

  getStatusByCanalId(canalId, candidatoId, nomeCanal) {
    return this.getOrCreate(canalId, candidatoId, nomeCanal).getStatus();
  }

  async connect(canalId, candidatoId, nomePerfil, nomeCanal) {
    return this.getOrCreate(canalId, candidatoId, nomeCanal).connect(nomePerfil);
  }

  async disconnect(canalId, candidatoId, nomeCanal) {
    return this.getOrCreate(canalId, candidatoId, nomeCanal).disconnect();
  }

  async trocarTelefone(canalId, candidatoId, nomePerfil, nomeCanal) {
    return this.getOrCreate(canalId, candidatoId, nomeCanal).trocarTelefone(nomePerfil);
  }

  async sendText(canalId, candidatoId, numero, mensagem, nomeCanal, opcoesBotoes = null) {
    return this.getOrCreate(canalId, candidatoId, nomeCanal).sendText(numero, mensagem, opcoesBotoes);
  }

  normalizarNumeroBrasil(numero) {
    return normalizarNumeroBrasil(numero);
  }

  extrairDigitosUsuarioJidWhatsapp(jid) {
    return extrairDigitosUsuarioJidWhatsapp(jid);
  }
}

module.exports = new WhatsappBaileysManager();
