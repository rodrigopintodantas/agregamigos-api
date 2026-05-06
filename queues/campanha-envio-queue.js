const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const QUEUE_NAME = "campanha-envio";
const defaultRedisHost = process.env.DOCKER_CONTAINER === "true" ? "redis" : "127.0.0.1";

const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || defaultRedisHost,
  port: Number(process.env.REDIS_PORT || 6379),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const campanhaEnvioQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: Number(process.env.CAMPANHA_ENVIO_TENTATIVAS || 5),
    backoff: {
      type: "exponential",
      delay: Number(process.env.CAMPANHA_ENVIO_BACKOFF_MS || 5000),
    },
    removeOnComplete: Number(process.env.CAMPANHA_ENVIO_REMOVER_SUCESSO || 1000),
    removeOnFail: Number(process.env.CAMPANHA_ENVIO_REMOVER_FALHA || 5000),
  },
});

async function validarFilaDisponivel() {
  await redisConnection.ping();
}

async function enfileirarDestinatarios(destinatarios) {
  if (!Array.isArray(destinatarios) || !destinatarios.length) return;

  await campanhaEnvioQueue.addBulk(
    destinatarios.map((d) => {
      const ts = new Date(d.agendado_para || new Date()).getTime();
      const delay = Number.isFinite(ts) ? Math.max(0, ts - Date.now()) : 0;
      return {
        name: "enviar-destinatario",
        data: {
          campanhaId: Number(d.campanha_id),
          destinatarioId: Number(d.id),
        },
        opts: {
          delay,
          jobId: `campanha_${Number(d.campanha_id)}_destinatario_${Number(d.id)}`,
        },
      };
    }),
  );
}

async function removerJobsPendentesDaCampanha(campanhaId) {
  const campanhaIdNumero = Number(campanhaId);
  if (!Number.isInteger(campanhaIdNumero) || campanhaIdNumero <= 0) return 0;

  const estados = ["wait", "paused", "delayed", "prioritized", "waiting-children"];
  const vistos = new Set();
  let totalRemovidos = 0;

  for (const estado of estados) {
    const jobs = await campanhaEnvioQueue.getJobs([estado], 0, -1, true);
    for (const job of jobs) {
      if (!job || vistos.has(job.id)) continue;
      vistos.add(job.id);
      if (Number(job.data?.campanhaId) !== campanhaIdNumero) continue;
      await job.remove();
      totalRemovidos += 1;
    }
  }

  return totalRemovidos;
}

module.exports = {
  QUEUE_NAME,
  redisConnection,
  campanhaEnvioQueue,
  validarFilaDisponivel,
  enfileirarDestinatarios,
  removerJobsPendentesDaCampanha,
};
