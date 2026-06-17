const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const fs = require("fs");
const { Worker } = require("bullmq");
const {
  CampanhaDivulgacaoModel,
  CampanhaDestinatarioModel,
  ModeloMensagemModel,
  PessoaModel,
  EnderecoModel,
  UsuarioModel,
  sequelize,
} = require("../models");
const { QUEUE_NAME, redisConnection } = require("../queues/campanha-envio-queue");

/** URL base da API para o worker chamar /whatsapp/send-interno (Baileys vive no processo da API). */
function resolverInternalApiUrl() {
  const emDocker =
    process.env.DOCKER_CONTAINER === "true" ||
    (() => {
      try {
        return fs.existsSync("/.dockerenv");
      } catch {
        return false;
      }
    })();
  const port = String(process.env.PORT || "3000");
  const padraoDocker = `http://api:${port}/api`;
  const padraoLocal = `http://127.0.0.1:${port}/api`;

  let raw = process.env.INTERNAL_API_URL != null ? String(process.env.INTERNAL_API_URL).trim() : "";
  // Sem URL explicita: API e worker no mesmo host/contentor (npm start, devcontainer).
  // O compose do worker de producao define INTERNAL_API_URL=http://api:3000/api no environment.
  if (!raw) {
    return padraoLocal;
  }
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    raw = `http://${raw}`;
  }
  raw = raw.replace(/\/+$/, "");
  if (!raw.endsWith("/api")) {
    raw = `${raw}/api`;
  }
  try {
    const host = new URL(raw).hostname;
    const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (emDocker && loopback) {
      return padraoDocker;
    }
    // .env de producao/Docker com host `api`, mas worker a correr no host (npm start)
    if (!emDocker && host === "api") {
      console.warn(
        "[worker] INTERNAL_API_URL aponta para host 'api' fora do Docker; usando API local.",
      );
      return padraoLocal;
    }
  } catch {
    /* usa raw abaixo */
  }
  return raw;
}

const INTERNAL_API_URL_RESOLVIDA = resolverInternalApiUrl();

function limitarErro(err) {
  return String(err?.message || "Falha ao enviar mensagem.").slice(0, 1000);
}

function identificarFalhaCodigo(err) {
  const msg = String(err?.message || "").toLowerCase();
  if (msg.includes("numero nao encontrado")) return "nao_whatsapp";
  if (msg.includes("numero invalido") || msg.includes("whatsapp invalido")) return "numero_invalido";
  if (msg.includes("canal whatsapp nao conectado")) return "canal_desconectado";
  if (msg.includes("jid de confirmacao divergente")) return "jid_divergente";
  if (msg.includes("confirmacao completa")) return "confirmacao_incompleta";
  if (msg.includes("timeout")) return "timeout_ack";
  return "envio_falhou";
}

function aplicarVariaveisMensagem(template, pessoa) {
  const texto = String(template || "");
  const nomeCompleto = String(pessoa?.nome || "").trim();
  const primeiroNome = nomeCompleto ? nomeCompleto.split(/\s+/)[0] : "";
  const bairro = String(pessoa?.EnderecoModel?.bairro || pessoa?.EnderecoModel?.cidade || "").trim();
  const nomeCoordenador = String(pessoa?.UsuarioModel?.nome || "").trim();

  return texto
    .replace(/\{\{\s*nome\s*\}\}/gi, nomeCompleto)
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiroNome)
    .replace(/\{\{\s*bairro\s*\}\}/gi, bairro)
    .replace(/\{\{\s*nome_coordenador\s*\}\}/gi, nomeCoordenador)
    .replace(/XXXX/g, nomeCompleto);
}

async function enviarViaApi(numero, mensagem, candidatoId, whatsappCanalId, opcoesBotoes = null) {
  const apiUrl = INTERNAL_API_URL_RESOLVIDA;
  const internalApiKey = process.env.INTERNAL_API_KEY || "dev-local-key";
  const cid = Number(candidatoId);
  const canalId = Number(whatsappCanalId);
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new Error("candidato_id invalido para envio WhatsApp.");
  }
  if (!Number.isInteger(canalId) || canalId <= 0) {
    throw new Error("whatsapp_canal_id invalido para envio WhatsApp.");
  }
  let response;
  try {
    response = await fetch(`${apiUrl}/whatsapp/send-interno`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-key": internalApiKey,
    },
    body: JSON.stringify({
      numero,
      mensagem,
      opcoes_botoes: opcoesBotoes,
      candidato_id: cid,
      whatsapp_canal_id: canalId,
    }),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes("fetch failed") || err?.cause?.code === "ECONNREFUSED") {
      throw new Error(
        `Nao foi possivel contactar a API interna em ${apiUrl}. ` +
          "Em Docker, o worker deve usar INTERNAL_API_URL=http://api:3000/api (mesma chave INTERNAL_API_KEY que a API).",
      );
    }
    throw err;
  }
  if (!response.ok) {
    let reason = `Falha HTTP ${response.status}`;
    try {
      const body = await response.json();
      reason = String(body?.message || reason);
    } catch (_err) {}
    throw new Error(reason);
  }

  let body = null;
  try {
    body = await response.json();
  } catch (_err) {
    throw new Error("Resposta invalida no envio interno.");
  }

  if (!body?.message_id || !body?.remote_jid || !body?.jid_resolvido) {
    throw new Error("Envio interno sem confirmacao completa do WhatsApp.");
  }
  if (String(body.remote_jid) !== String(body.jid_resolvido)) {
    throw new Error("JID de confirmacao divergente do destino.");
  }

  return {
    messageId: String(body.message_id),
    jid: String(body.jid_resolvido),
    numeroNormalizado: String(body.numero_normalizado || ""),
    whatsappMatch: String(body.whatsapp_match || ""),
  };
}

async function atualizarResumoCampanha(campanhaId) {
  const [total, enviados, pendentes] = await Promise.all([
    CampanhaDestinatarioModel.count({ where: { campanha_id: campanhaId } }),
    CampanhaDestinatarioModel.count({ where: { campanha_id: campanhaId, status: "enviado" } }),
    CampanhaDestinatarioModel.count({ where: { campanha_id: campanhaId, status: "pendente" } }),
  ]);

  const novoStatus = pendentes > 0 ? "em_andamento" : "finalizada";
  await CampanhaDivulgacaoModel.update(
    {
      total_destinatarios: total,
      total_enviados: enviados,
      status: novoStatus,
    },
    { where: { id: campanhaId } },
  );
}

async function marcarPessoaErroWhatsapp(pessoaId) {
  if (!pessoaId) return;
  await PessoaModel.update(
    { erroWhatsapp: true },
    { where: { id: Number(pessoaId) } },
  );
}

async function processarEnvio(job) {
  const destinatarioId = Number(job?.data?.destinatarioId);
  const campanhaId = Number(job?.data?.campanhaId);
  if (!destinatarioId || !campanhaId) throw new Error("Payload do job invalido.");

  const destinatario = await CampanhaDestinatarioModel.findOne({
    where: { id: destinatarioId, campanha_id: campanhaId },
    include: [
      { model: ModeloMensagemModel, attributes: ["id", "corpo", "tipo_mensagem", "opcoes_botoes"] },
      {
        model: PessoaModel,
        attributes: ["id", "nome"],
        include: [
          { model: EnderecoModel, attributes: ["bairro", "cidade"], required: false },
          { model: UsuarioModel, attributes: ["nome"], required: false },
        ],
      },
    ],
  });
  if (!destinatario) return;
  if (String(destinatario.status) !== "pendente") return;

  const campanha = await CampanhaDivulgacaoModel.findByPk(campanhaId, {
    attributes: ["id", "status", "candidatoId", "whatsapp_canal_id"],
  });
  if (!campanha) return;
  const canalId = Number(campanha.whatsapp_canal_id);
  if (!Number.isInteger(canalId) || canalId <= 0) {
    await destinatario.update({
      status: "erro",
      tentativas: destinatario.tentativas + 1,
      falha_entrega: true,
      falha_codigo: "canal_ausente",
      falha_em: new Date(),
      erro_ultimo: "Campanha sem canal WhatsApp definido.",
    });
    await atualizarResumoCampanha(campanhaId);
    return;
  }
  if (String(campanha.status) === "cancelada") {
    await destinatario.update({
      status: "cancelado",
      falha_entrega: false,
      falha_codigo: null,
      falha_em: null,
      erro_ultimo: "Envio interrompido: campanha cancelada.",
    });
    await atualizarResumoCampanha(campanhaId);
    return;
  }

  const numero = String(destinatario.whatsapp || "").replace(/\D/g, "");
  if (!numero) {
    await destinatario.update({
      status: "erro",
      tentativas: destinatario.tentativas + 1,
      falha_entrega: true,
      falha_codigo: "numero_invalido",
      falha_em: new Date(),
      erro_ultimo: "WhatsApp invalido para envio.",
    });
    await marcarPessoaErroWhatsapp(destinatario?.PessoaModel?.id);
    await atualizarResumoCampanha(campanhaId);
    return;
  }

  const modelo = destinatario.ModeloMensagemModel;
  const mensagem = aplicarVariaveisMensagem(modelo?.corpo, destinatario.PessoaModel).trim();
  const opcoesBotoes =
    String(modelo?.tipo_mensagem || "").toLowerCase() === "botoes"
      ? (Array.isArray(modelo?.opcoes_botoes) ? modelo.opcoes_botoes : [])
      : null;
  if (!mensagem) {
    await destinatario.update({
      status: "erro",
      tentativas: destinatario.tentativas + 1,
      falha_entrega: true,
      falha_codigo: "mensagem_vazia",
      falha_em: new Date(),
      erro_ultimo: "Modelo sem corpo para envio.",
    });
    await atualizarResumoCampanha(campanhaId);
    return;
  }

  const transaction = await sequelize.transaction();
  try {
    const envio = await enviarViaApi(
      numero,
      mensagem,
      campanha.candidatoId,
      campanha.whatsapp_canal_id,
      opcoesBotoes,
    );
    const whatsappArmazenar = String(envio.whatsappMatch || envio.numeroNormalizado || numero || "")
      .replace(/\D/g, "")
      .slice(0, 20);
    await destinatario.update(
      {
        status: "enviado",
        tentativas: destinatario.tentativas + 1,
        enviado_em: new Date(),
        falha_entrega: false,
        falha_codigo: null,
        falha_em: null,
        wa_message_id_envio: envio.messageId,
        whatsapp: whatsappArmazenar || String(destinatario.whatsapp || "").replace(/\D/g, "").slice(0, 20),
        resposta_1_texto: null,
        resposta_1_em: null,
        resposta_1_wa_id: null,
        resposta_1_sentimento: null,
        resposta_2_texto: null,
        resposta_2_em: null,
        resposta_2_wa_id: null,
        resposta_2_sentimento: null,
        erro_ultimo: `OK message_id=${envio.messageId} jid=${envio.jid}`,
      },
      { transaction },
    );
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    const falhaCodigo = identificarFalhaCodigo(err);
    await destinatario.update({
      status: "erro",
      tentativas: destinatario.tentativas + 1,
      falha_entrega: true,
      falha_codigo: falhaCodigo,
      falha_em: new Date(),
      erro_ultimo: limitarErro(err),
    });
    await marcarPessoaErroWhatsapp(destinatario?.PessoaModel?.id);
    throw err;
  } finally {
    await atualizarResumoCampanha(campanhaId);
  }
}

async function iniciarWorker() {
  await sequelize.authenticate();
  console.log(`[worker] API interna (envio WhatsApp): ${INTERNAL_API_URL_RESOLVIDA}`);
  const worker = new Worker(QUEUE_NAME, processarEnvio, {
    connection: redisConnection,
    concurrency: Number(process.env.CAMPANHA_ENVIO_CONCURRENCY || 4),
  });

  worker.on("ready", () => {
    console.log("[worker] Campanha envio worker pronto.");
  });
  worker.on("completed", (job) => {
    console.log(`[worker] Job concluido: ${job.id}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] Job falhou: ${job?.id} - ${limitarErro(err)}`);
  });

  process.on("SIGINT", async () => {
    await worker.close();
    process.exit(0);
  });
}

iniciarWorker().catch((err) => {
  console.error("[worker] Falha ao iniciar worker:", err);
  process.exit(1);
});
