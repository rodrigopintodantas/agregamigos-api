const path = require("path");
const QRCode = require("qrcode");
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const { anexarCapturaRespostas } = require("./whatsapp-captura-respostas-campanha");

class WhatsappBaileysService {
  constructor() {
    this.sock = null;
    this.conectando = false;
    this.estado = {
      conectado: false,
      status: "desconectado",
      numero: null,
      nomePerfil: null,
      qrCode: null,
      ultimaAtualizacao: new Date().toISOString(),
    };
  }

  getStatus() {
    return { ...this.estado };
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

    const authFolder = path.resolve(process.cwd(), ".baileys_auth");
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      syncFullHistory: false,
    });

    socket.ev.on("creds.update", saveCreds);
    anexarCapturaRespostas(socket);

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
    const digits = this.normalizarNumeroBrasil(numero);
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

  normalizarNumeroBrasil(numero) {
    let digits = String(numero || "").replace(/\D/g, "");
    if (!digits) return "";

    // Remove prefixo internacional 00...
    digits = digits.replace(/^00+/, "");

    // Remove tronco nacional com operadora (ex.: 01511999999999 -> 11999999999)
    const matchComOperadora = digits.match(/^0\d{2}(\d{10,11})$/);
    if (matchComOperadora?.[1]) {
      digits = matchComOperadora[1];
    } else {
      // Remove zero de tronco nacional simples (ex.: 011999999999 -> 11999999999)
      digits = digits.replace(/^0+/, "");
    }

    // Ja internacional BR
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
      return digits;
    }

    // Cadastro local sem DDD (MVP DF): assume DDD 61.
    if (digits.length === 8 || digits.length === 9) {
      digits = `61${digits}`;
    }

    // Nacional BR sem DDI
    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }

    // Mantem fallback para outros formatos internacionais (MVP)
    return digits;
  }

  atualizarEstado(parcial) {
    this.estado = {
      ...this.estado,
      ...parcial,
      ultimaAtualizacao: new Date().toISOString(),
    };
  }
}

module.exports = new WhatsappBaileysService();
