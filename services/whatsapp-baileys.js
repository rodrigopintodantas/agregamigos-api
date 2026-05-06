const path = require("path");
const QRCode = require("qrcode");
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

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
    const digits = String(numero || "").replace(/\D/g, "");
    if (!digits) throw new Error("Numero de destino invalido.");
    const jid = `${digits}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text: String(mensagem || "").trim() });
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
