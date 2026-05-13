const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const { anexarCapturaRespostas } = require("./whatsapp-captura-respostas-campanha");

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

/**
 * Move credenciais antigas (arquivos soltos em `.baileys_auth/`) para `.baileys_auth/candidato_1/`.
 */
function resolverPastaAuthBaileys(candidatoId) {
  const id = Number(candidatoId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("candidato_id invalido para pasta de auth do WhatsApp.");
  }

  const root = path.join(process.cwd(), ".baileys_auth");
  const dest = path.join(root, `candidato_${id}`);

  if (fs.existsSync(dest)) {
    return dest;
  }

  fs.mkdirSync(root, { recursive: true });

  if (id === 1) {
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      entries = [];
    }
    const hasScoped = entries.some((e) => e.startsWith("candidato_"));
    const hasCredsAtRoot = entries.includes("creds.json");
    if (!hasScoped && hasCredsAtRoot) {
      fs.mkdirSync(dest, { recursive: true });
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
          fs.renameSync(from, path.join(dest, name));
        }
      }
      return dest;
    }
  }

  fs.mkdirSync(dest, { recursive: true });
  return dest;
}

class WhatsappPorCandidato {
  constructor(candidatoId) {
    this.candidatoId = Number(candidatoId);
    this.sock = null;
    this.conectando = false;
    this.estado = {
      conectado: false,
      status: "desconectado",
      numero: null,
      nomePerfil: null,
      qrCode: null,
      candidato_id: this.candidatoId,
      ultimaAtualizacao: new Date().toISOString(),
    };
  }

  getStatus() {
    return { ...this.estado };
  }

  atualizarEstado(parcial) {
    this.estado = {
      ...this.estado,
      ...parcial,
      candidato_id: this.candidatoId,
      ultimaAtualizacao: new Date().toISOString(),
    };
  }

  async connect(nomePerfil = "Canal principal") {
    if (this.sock || this.conectando) {
      return this.getStatus();
    }

    this.conectando = true;
    this.atualizarEstado({
      status: "conectando",
      conectado: false,
      nomePerfil,
      qrCode: null,
    });

    const authFolder = resolverPastaAuthBaileys(this.candidatoId);
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      syncFullHistory: false,
    });

    socket.ev.on("creds.update", saveCreds);
    anexarCapturaRespostas(socket, this.candidatoId);

    socket.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        const qrCode = await QRCode.toDataURL(qr);
        this.atualizarEstado({
          status: "aguardando_qr",
          conectado: false,
          qrCode,
        });
      }

      if (connection === "open") {
        const user = socket.user?.id ? String(socket.user.id).split(":")[0] : null;
        this.atualizarEstado({
          status: "conectado",
          conectado: true,
          numero: user,
          qrCode: null,
        });
        this.conectando = false;
      }

      if (connection === "close") {
        const reason = Number(lastDisconnect?.error?.output?.statusCode || 0);
        const loggedOut = reason === DisconnectReason.loggedOut;
        this.sock = null;
        this.conectando = false;
        this.atualizarEstado({
          status: loggedOut ? "desconectado" : "reconectando",
          conectado: false,
          numero: null,
        });

        if (!loggedOut) {
          await this.connect(this.estado.nomePerfil || nomePerfil);
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
    this.atualizarEstado({
      conectado: false,
      status: "desconectado",
      numero: null,
      qrCode: null,
      nomePerfil: null,
    });
    return this.getStatus();
  }

  async sendText(numero, mensagem) {
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

    const texto = String(mensagem || "").trim();
    if (!texto) {
      throw new Error("Mensagem vazia para envio.");
    }

    const resultado = await this.sock.sendMessage(jidResolvido, { text: texto });
    if (!resultado?.key?.id || !resultado?.key?.remoteJid) {
      throw new Error("WhatsApp nao confirmou o envio da mensagem.");
    }
    return {
      numeroNormalizado: digits,
      jidDigitado,
      jidResolvido,
      messageId: resultado.key.id,
      remoteJid: resultado.key.remoteJid,
    };
  }
}

class WhatsappBaileysManager {
  constructor() {
    /** @type {Map<number, WhatsappPorCandidato>} */
    this.instances = new Map();
  }

  parseCandidatoId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("candidato_id invalido.");
    }
    return id;
  }

  getOrCreate(candidatoId) {
    const id = this.parseCandidatoId(candidatoId);
    if (!this.instances.has(id)) {
      this.instances.set(id, new WhatsappPorCandidato(id));
    }
    return this.instances.get(id);
  }

  getStatus(candidatoId) {
    const id = this.parseCandidatoId(candidatoId);
    return this.getOrCreate(id).getStatus();
  }

  async connect(candidatoId, nomePerfil) {
    return this.getOrCreate(candidatoId).connect(nomePerfil);
  }

  async disconnect(candidatoId) {
    return this.getOrCreate(candidatoId).disconnect();
  }

  async sendText(candidatoId, numero, mensagem) {
    return this.getOrCreate(candidatoId).sendText(numero, mensagem);
  }

  normalizarNumeroBrasil(numero) {
    return normalizarNumeroBrasil(numero);
  }
}

module.exports = new WhatsappBaileysManager();
