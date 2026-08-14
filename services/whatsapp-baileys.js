const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const {
  default: makeWASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  proto,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const { normalizarOpcoesBotoes } = require("../utils/modelo-mensagem-botoes");
const { anexarCapturaRespostas } = require("./whatsapp-captura-respostas-campanha");
const { persistirEstadoCanal, formatarNumeroCanal } = require("./whatsapp-canal-db");
const { verificarLimiteDiarioCanal, booleanoEnv, numeroEnvOuPadrao } = require("./whatsapp-limites-envio");

/** Mensagens de erro reconhecidas pelo worker para decidir entre reagendar e falhar. */
const ERRO_LIMITE_DIARIO = "Limite diario de envios do canal atingido.";
const ERRO_CANAL_PAUSADO = "Canal pausado por protecao anti-bloqueio.";
const ERRO_CANAL_OCUPADO = "Canal ocupado com outro envio.";

function esperar(ms) {
  const tempo = Math.max(0, Number(ms) || 0);
  if (!tempo) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, tempo));
}

function inteiroAleatorio(min, max) {
  const menor = Math.min(min, max);
  const maior = Math.max(min, max);
  return Math.floor(Math.random() * (maior - menor + 1)) + menor;
}

/** Intervalo mínimo entre dois envios do mesmo número, com variação aleatória. */
function intervaloEntreEnviosMs() {
  const min = numeroEnvOuPadrao("WHATSAPP_INTERVALO_MIN_MS", 25000, 0);
  const max = numeroEnvOuPadrao("WHATSAPP_INTERVALO_MAX_MS", 75000, 0);
  return inteiroAleatorio(min, Math.max(min, max));
}

/** Tempo de "digitando..." proporcional ao texto, como um humano faria. */
function duracaoDigitacaoMs(texto) {
  const caracteres = String(texto || "").length;
  const porCaractere = numeroEnvOuPadrao("WHATSAPP_MS_POR_CARACTERE", 55, 0);
  const minimo = numeroEnvOuPadrao("WHATSAPP_DIGITACAO_MIN_MS", 1800, 0);
  const maximo = numeroEnvOuPadrao("WHATSAPP_DIGITACAO_MAX_MS", 12000, 0);
  const estimado = caracteres * porCaractere;
  const comRuido = estimado * (0.8 + Math.random() * 0.5);
  return Math.min(maximo, Math.max(minimo, Math.round(comRuido)));
}

function simularDigitacaoAtiva() {
  return booleanoEnv("WHATSAPP_SIMULAR_DIGITACAO", true);
}

/**
 * Botões nativos por API não oficial são um dos vetores mais associados a bloqueio.
 * Desativado por padrão: as opções passam a ser listadas no corpo do texto.
 */
function botoesNativosPermitidos() {
  return booleanoEnv("WHATSAPP_PERMITIR_BOTOES_NATIVOS", false);
}

function falhasParaPausarCanal() {
  return numeroEnvOuPadrao("WHATSAPP_FALHAS_PARA_PAUSAR", 5, 1);
}

function duracaoPausaProtecaoMs() {
  return numeroEnvOuPadrao("WHATSAPP_PAUSA_PROTECAO_MS", 30 * 60 * 1000, 0);
}

function ttlCacheOnWhatsappMs() {
  return numeroEnvOuPadrao("WHATSAPP_TTL_CACHE_NUMERO_MS", 7 * 24 * 60 * 60 * 1000, 0);
}

function navegadorSocket() {
  const perfil = String(process.env.WHATSAPP_NAVEGADOR || "macos").trim().toLowerCase();
  if (typeof Browsers?.macOS === "function") {
    if (perfil === "ubuntu" && typeof Browsers.ubuntu === "function") return Browsers.ubuntu("Chrome");
    if (perfil === "windows" && typeof Browsers.windows === "function") return Browsers.windows("Desktop");
    return Browsers.macOS("Desktop");
  }
  return ["Mac OS", "Desktop", "10.15.7"];
}

/**
 * Motivos de desconexão que indicam bloqueio/expulsão: reconectar em loop
 * nesses casos piora a situação do número.
 */
function desconexaoDefinitiva(statusCode) {
  const codigo = Number(statusCode || 0);
  return (
    codigo === DisconnectReason.loggedOut ||
    codigo === DisconnectReason.forbidden ||
    codigo === DisconnectReason.badSession ||
    codigo === 401 ||
    codigo === 403
  );
}

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

/** Sem botões nativos, as opções vão numeradas no corpo da mensagem. */
function textoComOpcoesEmLista(texto, botoes) {
  if (!Array.isArray(botoes) || botoes.length < 2) return texto;
  const lista = botoes.map((label, idx) => `${idx + 1}. ${label}`).join("\n");
  return `${texto}\n\n${lista}`;
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

/** Indica se o canal já tem sessão pareada em disco (pode reconectar sem QR Code). */
function existeCredencialSalva(candidatoId, canalId) {
  try {
    const pasta = resolverPastaAuthBaileys(candidatoId, canalId);
    return fs.existsSync(path.join(pasta, "creds.json"));
  } catch {
    return false;
  }
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
    /** Cadeia de promessas: garante um envio por vez neste número. */
    this.filaEnvio = Promise.resolve();
    this.envioPendentes = 0;
    this.ultimoEnvioEm = 0;
    this.falhasConsecutivas = 0;
    this.pausadoAte = 0;
    this.tentativasReconexao = 0;
    this.timerReconexao = null;
    /** Cache de `onWhatsApp` por número: evita uma consulta extra a cada envio. */
    this.cacheNumeros = new Map();
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
      browser: navegadorSocket(),
      // Não anunciar presença permanente: o número fica com aparência de uso normal
      // e as notificações continuam a chegar ao telemóvel.
      markOnlineOnConnect: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid) => String(jid || "").endsWith("@broadcast"),
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: numeroEnvOuPadrao("WHATSAPP_QUERY_TIMEOUT_MS", 60000, 1000),
      keepAliveIntervalMs: numeroEnvOuPadrao("WHATSAPP_KEEPALIVE_MS", 25000, 5000),
      retryRequestDelayMs: numeroEnvOuPadrao("WHATSAPP_RETRY_REQUEST_MS", 1500, 100),
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
        this.tentativasReconexao = 0;
        this.falhasConsecutivas = 0;
        this.pausadoAte = 0;
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
        const definitiva = desconexaoDefinitiva(reason);
        this.sock = null;
        this.conectando = false;
        await this.atualizarEstado({
          status: definitiva ? "desconectado" : "reconectando",
          conectado: false,
          numero: null,
        });

        if (definitiva) {
          console.warn(
            `[whatsapp-baileys] Canal ${this.canalId} desconectado definitivamente (codigo ${reason}). ` +
              "Reconexao automatica desativada: releia o QR Code.",
          );
          return;
        }
        this.agendarReconexao(this.estado.nomePerfil || perfil);
      }
    });

    this.sock = socket;
    this.conectando = false;
    return this.getStatus();
  }

  /** Reconexão com recuo exponencial: evita loop agressivo em instabilidade. */
  agendarReconexao(perfil) {
    if (this.timerReconexao) return;

    const maxTentativas = numeroEnvOuPadrao("WHATSAPP_MAX_TENTATIVAS_RECONEXAO", 10, 1);
    if (this.tentativasReconexao >= maxTentativas) {
      console.warn(
        `[whatsapp-baileys] Canal ${this.canalId}: ${this.tentativasReconexao} tentativas de reconexao sem sucesso. Parando.`,
      );
      this.atualizarEstado({ status: "desconectado", conectado: false, numero: null }).catch(() => {});
      return;
    }

    this.tentativasReconexao += 1;
    const base = numeroEnvOuPadrao("WHATSAPP_RECONEXAO_BASE_MS", 5000, 500);
    const teto = numeroEnvOuPadrao("WHATSAPP_RECONEXAO_TETO_MS", 5 * 60 * 1000, 1000);
    const espera = Math.min(teto, base * 2 ** (this.tentativasReconexao - 1));
    const comJitter = espera + inteiroAleatorio(0, Math.floor(espera / 2));

    console.log(
      `[whatsapp-baileys] Canal ${this.canalId}: reconectando em ${Math.round(comJitter / 1000)}s (tentativa ${this.tentativasReconexao}).`,
    );

    this.timerReconexao = setTimeout(() => {
      this.timerReconexao = null;
      this.connect(perfil).catch((err) => {
        console.error("[whatsapp-baileys] Falha na reconexao:", err?.message || err);
        this.agendarReconexao(perfil);
      });
    }, comJitter);
  }

  /** Pausa o canal após falhas consecutivas, para não insistir num número já sinalizado. */
  registrarFalhaEnvio() {
    this.falhasConsecutivas += 1;
    const limite = falhasParaPausarCanal();
    if (this.falhasConsecutivas < limite) return;

    const pausaMs = duracaoPausaProtecaoMs();
    this.pausadoAte = Date.now() + pausaMs;
    this.falhasConsecutivas = 0;
    console.warn(
      `[whatsapp-baileys] Canal ${this.canalId} pausado por ${Math.round(pausaMs / 60000)} min ` +
        `apos ${limite} falhas consecutivas de envio.`,
    );
  }

  garantirCanalNaoPausado() {
    if (!this.pausadoAte) return;
    if (Date.now() >= this.pausadoAte) {
      this.pausadoAte = 0;
      return;
    }
    const restanteS = Math.ceil((this.pausadoAte - Date.now()) / 1000);
    throw new Error(`${ERRO_CANAL_PAUSADO} Retoma em ${restanteS}s.`);
  }

  /** Espera o intervalo mínimo desde o último envio deste número. */
  async aguardarRitmoEnvio() {
    if (!this.ultimoEnvioEm) return;
    const alvo = this.ultimoEnvioEm + intervaloEntreEnviosMs();
    const restante = alvo - Date.now();
    if (restante > 0) await esperar(restante);
  }

  async resolverJidDestino(digits) {
    const cacheado = this.cacheNumeros.get(digits);
    const ttl = ttlCacheOnWhatsappMs();
    if (cacheado && (!ttl || Date.now() - cacheado.em < ttl)) {
      if (!cacheado.existe) throw new Error("Numero nao encontrado no WhatsApp.");
      return cacheado.jid;
    }

    const jidDigitado = `${digits}@s.whatsapp.net`;
    const existe = await this.sock.onWhatsApp(jidDigitado);
    const encontrado = Array.isArray(existe) && existe.length && existe[0]?.exists;
    if (!encontrado) {
      this.cacheNumeros.set(digits, { existe: false, jid: null, em: Date.now() });
      throw new Error("Numero nao encontrado no WhatsApp.");
    }

    const jidResolvido = String(existe[0]?.jid || jidDigitado);
    this.cacheNumeros.set(digits, { existe: true, jid: jidResolvido, em: Date.now() });
    return jidResolvido;
  }

  /** Presença + "digitando..." antes de enviar, imitando uso humano do aplicativo. */
  async simularDigitacao(jid, texto) {
    if (!simularDigitacaoAtiva()) return;
    try {
      await this.sock.presenceSubscribe(jid);
      await esperar(inteiroAleatorio(400, 1200));
      await this.sock.sendPresenceUpdate("composing", jid);
      await esperar(duracaoDigitacaoMs(texto));
      await this.sock.sendPresenceUpdate("paused", jid);
      await esperar(inteiroAleatorio(200, 600));
    } catch (err) {
      // Presença é acessória: falha aqui não deve impedir o envio.
      console.warn("[whatsapp-baileys] Falha ao simular digitacao:", err?.message || err);
    }
  }

  async disconnect() {
    if (this.timerReconexao) {
      clearTimeout(this.timerReconexao);
      this.timerReconexao = null;
    }
    this.tentativasReconexao = 0;
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
    // Número novo: cache de destinos e proteções recomeçam do zero.
    this.cacheNumeros.clear();
    this.ultimoEnvioEm = 0;
    this.falhasConsecutivas = 0;
    this.pausadoAte = 0;
    return this.connect(nomePerfil || this.nomeCanal);
  }

  /** Serializa os envios deste número: nunca dois em paralelo no mesmo socket. */
  async sendText(numero, mensagem, opcoesBotoes = null) {
    // Fila curta de propósito: quem chega além do limite é reagendado pelo worker,
    // em vez de manter a requisição HTTP aberta durante minutos.
    const maxFila = numeroEnvOuPadrao("WHATSAPP_MAX_FILA_ENVIO", 2, 1);
    if (this.envioPendentes >= maxFila) {
      throw new Error(`${ERRO_CANAL_OCUPADO} Tente novamente em instantes.`);
    }

    this.envioPendentes += 1;
    const executar = () => this.executarEnvio(numero, mensagem, opcoesBotoes);
    const execucao = this.filaEnvio.then(executar, executar).finally(() => {
      this.envioPendentes -= 1;
    });
    // A cadeia é neutralizada para que uma falha não derrube os envios seguintes.
    this.filaEnvio = execucao.then(
      () => undefined,
      () => undefined,
    );
    return execucao;
  }

  async executarEnvio(numero, mensagem, opcoesBotoes) {
    if (!this.sock || !this.estado.conectado) {
      throw new Error("Canal WhatsApp nao conectado.");
    }
    this.garantirCanalNaoPausado();

    const limite = await verificarLimiteDiarioCanal(this.canalId);
    if (!limite.permitido) {
      throw new Error(`${ERRO_LIMITE_DIARIO} Enviados hoje: ${limite.enviados}/${limite.limite}.`);
    }

    const digits = normalizarNumeroBrasil(numero);
    if (!digits) throw new Error("Numero de destino invalido.");

    const texto = String(mensagem || "").trim();
    if (!texto) throw new Error("Mensagem vazia para envio.");

    await this.aguardarRitmoEnvio();

    try {
      const resultado = await this.entregarMensagem(digits, texto, opcoesBotoes);
      this.ultimoEnvioEm = Date.now();
      this.falhasConsecutivas = 0;
      return resultado;
    } catch (err) {
      this.ultimoEnvioEm = Date.now();
      // Número inexistente é problema do destino, não sinal de bloqueio do canal.
      if (!String(err?.message || "").includes("Numero nao encontrado")) {
        this.registrarFalhaEnvio();
      }
      throw err;
    }
  }

  async entregarMensagem(digits, texto, opcoesBotoes) {
    const jidResolvido = await this.resolverJidDestino(digits);
    const digitosNoJid = extrairDigitosUsuarioJidWhatsapp(jidResolvido);
    const whatsappMatch = digitosNoJid && digitosNoJid.length >= 11 ? digitosNoJid : digits;
    const jidDigitado = `${digits}@s.whatsapp.net`;

    const botoes = normalizarOpcoesBotoes(opcoesBotoes);
    const usarBotoesNativos = botoes.length >= 2 && botoesNativosPermitidos();
    const textoFinal = usarBotoesNativos ? texto : textoComOpcoesEmLista(texto, botoes);

    await this.simularDigitacao(jidResolvido, textoFinal);

    let messageId;
    let remoteJid = jidResolvido;

    if (usarBotoesNativos) {
      const buttons = botoes.map((label, idx) => ({
        buttonId: `mdl_${idx}_${Date.now()}`,
        buttonText: { displayText: label },
        type: proto.Message.ButtonsMessage.Button.Type.RESPONSE,
      }));
      const waMessage = {
        buttonsMessage: {
          contentText: textoFinal,
          footerText: "",
          buttons,
          headerType: proto.Message.ButtonsMessage.HeaderType.EMPTY,
        },
      };
      messageId = generateMessageIDV2(this.sock.user?.id);
      await this.sock.relayMessage(jidResolvido, waMessage, { messageId });
    } else {
      const resultado = await this.sock.sendMessage(jidResolvido, { text: textoFinal });
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

  /**
   * Reconecta no arranque da API os canais que já têm sessão em disco.
   * Sem isto, todo reinício fazia as campanhas em curso falharem por canal desconectado.
   */
  async restaurarSessoesSalvas() {
    if (!booleanoEnv("WHATSAPP_RESTAURAR_SESSOES", true)) return { restaurados: 0 };

    const { WhatsappCanalModel } = require("../models");
    const canais = await WhatsappCanalModel.findAll({
      attributes: ["id", "candidatoId", "nome"],
      order: [["id", "ASC"]],
    });

    let restaurados = 0;
    for (const canal of canais) {
      if (!existeCredencialSalva(canal.candidatoId, canal.id)) continue;
      try {
        await this.connect(canal.id, canal.candidatoId, canal.nome, canal.nome);
        restaurados += 1;
        // Espaçar as reconexões evita um pico de handshakes simultâneos.
        await esperar(inteiroAleatorio(1500, 4000));
      } catch (err) {
        console.error(
          `[whatsapp-baileys] Falha ao restaurar canal ${canal.id}:`,
          err?.message || err,
        );
      }
    }
    return { restaurados };
  }

  normalizarNumeroBrasil(numero) {
    return normalizarNumeroBrasil(numero);
  }

  extrairDigitosUsuarioJidWhatsapp(jid) {
    return extrairDigitosUsuarioJidWhatsapp(jid);
  }
}

const manager = new WhatsappBaileysManager();
manager.ERRO_LIMITE_DIARIO = ERRO_LIMITE_DIARIO;
manager.ERRO_CANAL_PAUSADO = ERRO_CANAL_PAUSADO;
manager.ERRO_CANAL_OCUPADO = ERRO_CANAL_OCUPADO;

module.exports = manager;
