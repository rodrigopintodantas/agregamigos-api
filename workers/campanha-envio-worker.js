require("dotenv").config();

const { Worker } = require("bullmq");
const {
  CampanhaDivulgacaoModel,
  CampanhaDestinatarioModel,
  ModeloMensagemModel,
  sequelize,
} = require("../models");
const whatsappService = require("../services/whatsapp-baileys");
const { QUEUE_NAME, redisConnection } = require("../queues/campanha-envio-queue");

function limitarErro(err) {
  return String(err?.message || "Falha ao enviar mensagem.").slice(0, 1000);
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
    await whatsappService.sendText(numero, mensagem);
    await destinatario.update(
      {
        status: "enviado",
        tentativas: destinatario.tentativas + 1,
        enviado_em: new Date(),
        erro_ultimo: null,
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
