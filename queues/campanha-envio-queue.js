const fs = require("fs");
const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const QUEUE_NAME = "campanha-envio";

/**
 * Host por defeito quando REDIS_HOST não está definido, ou quando está em loopback
 * dentro de Docker (ficheiro .env copiado do exemplo aponta para 127.0.0.1, mas o Redis
 * é o serviço `redis` na mesma rede).
 */
function resolverRedisHostPadrao() {
  const emDocker =
    process.env.DOCKER_CONTAINER === "true" ||
    (() => {
      try {
        return fs.existsSync("/.dockerenv");
      } catch {
        return false;
      }
    })();
  const hostRaw = process.env.REDIS_HOST != null ? String(process.env.REDIS_HOST).trim() : "";
  if (hostRaw) {
    const loopback = hostRaw === "127.0.0.1" || hostRaw === "localhost" || hostRaw === "::1";
    if (emDocker && loopback) {
      return "redis";
    }
    return hostRaw;
  }
  if (emDocker) {
    return "redis";
  }
  return "127.0.0.1";
}

function criarRedisConnection() {
  const redisUrl = process.env.REDIS_URL != null ? String(process.env.REDIS_URL).trim() : "";
  const common = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  if (redisUrl) {
    return new IORedis(redisUrl, common);
  }
  return new IORedis({
    ...common,
    host: resolverRedisHostPadrao(),
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
  });
}

const redisConnection = criarRedisConnection();

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

async function removerJobsDaCampanha(campanhaId, estados) {
  const campanhaIdNumero = Number(campanhaId);
  if (!Number.isInteger(campanhaIdNumero) || campanhaIdNumero <= 0) return 0;

  const listaEstados = Array.isArray(estados) && estados.length ? estados : [];
  const vistos = new Set();
  let totalRemovidos = 0;

  for (const estado of listaEstados) {
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

async function removerJobsPendentesDaCampanha(campanhaId) {
  return removerJobsDaCampanha(campanhaId, [
    "wait",
    "paused",
    "delayed",
    "prioritized",
    "waiting-children",
  ]);
}

/** Remove jobs da fila antes de excluir a campanha (inclui envios em curso na fila). */
async function removerTodosJobsDaCampanha(campanhaId) {
  return removerJobsDaCampanha(campanhaId, [
    "wait",
    "paused",
    "delayed",
    "prioritized",
    "waiting-children",
    "active",
    "completed",
    "failed",
  ]);
}

module.exports = {
  QUEUE_NAME,
  redisConnection,
  campanhaEnvioQueue,
  validarFilaDisponivel,
  enfileirarDestinatarios,
  removerJobsPendentesDaCampanha,
  removerTodosJobsDaCampanha,
};
