require("dotenv").config();

const { Worker } = require("bullmq");
const {
  CampanhaDivulgacaoModel,
  CampanhaDestinatarioModel,
  ModeloMensagemModel,
  sequelize,
} = require("../models");
const { QUEUE_NAME, redisConnection } = require("../queues/campanha-envio-queue");

function limitarErro(err) {
  return String(err?.message || "Falha ao enviar mensagem.").slice(0, 1000);
}

async function enviarViaApi(numero, mensagem) {
  const apiUrl = process.env.INTERNAL_API_URL || "http://127.0.0.1:3000/api";
  const internalApiKey = process.env.INTERNAL_API_KEY || "dev-local-key";
  const response = await fetch(`${apiUrl}/whatsapp/send-interno`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-key": internalApiKey,
    },
    body: JSON.stringify({ numero, mensagem }),
  });
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

async function processarEnvio(job) {
  const destinatarioId = Number(job?.data?.destinatarioId);
  const campanhaId = Number(job?.data?.campanhaId);
  if (!destinatarioId || !campanhaId) throw new Error("Payload do job invalido.");

  const destinatario = await CampanhaDestinatarioModel.findOne({
    where: { id: destinatarioId, campanha_id: campanhaId },
    include: [{ model: ModeloMensagemModel, attributes: ["id", "corpo"] }],
  });
  if (!destinatario) return;
  if (String(destinatario.status) !== "pendente") return;

  const campanha = await CampanhaDivulgacaoModel.findByPk(campanhaId, {
    attributes: ["id", "status"],
  });
  if (!campanha) return;
  if (String(campanha.status) === "cancelada") {
    await destinatario.update({
      status: "cancelado",
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
      erro_ultimo: "WhatsApp invalido para envio.",
    });
    await atualizarResumoCampanha(campanhaId);
    return;
  }

  const mensagem = String(destinatario.ModeloMensagemModel?.corpo || "").trim();
  if (!mensagem) {
    await destinatario.update({
      status: "erro",
      tentativas: destinatario.tentativas + 1,
      erro_ultimo: "Modelo sem corpo para envio.",
    });
    await atualizarResumoCampanha(campanhaId);
    return;
  }

  const transaction = await sequelize.transaction();
  try {
    const envio = await enviarViaApi(numero, mensagem);
    await destinatario.update(
      {
        status: "enviado",
        tentativas: destinatario.tentativas + 1,
        enviado_em: new Date(),
        erro_ultimo: `OK message_id=${envio.messageId} jid=${envio.jid}`,
      },
      { transaction },
    );
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    await destinatario.update({
      status: "erro",
      tentativas: destinatario.tentativas + 1,
      erro_ultimo: limitarErro(err),
    });
    throw err;
  } finally {
    await atualizarResumoCampanha(campanhaId);
  }
}

async function iniciarWorker() {
  await sequelize.authenticate();
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
