"use strict";

const { Op } = require("sequelize");
const { CampanhaDestinatarioModel, PessoaModel } = require("../models");

const MS_48H = 48 * 60 * 60 * 1000;

function obterJanelaMs() {
  const raw = Number(process.env.CAMPANHA_RESPOSTA_JANELA_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return MS_48H;
}

/**
 * Primeiro disparo (primeiro enviado da pessoa) sem nenhuma resposta em 48h → pessoa fica `sem_resposta`.
 * Não altera quem já está positivo, negativo ou neutro (campanhas posteriores sem resposta mantêm o último engajamento).
 */
async function executarMarcacaoSemRespostaPrimeiroContato() {
  const janelaMs = obterJanelaMs();
  const limite = new Date(Date.now() - janelaMs);

  const candidatos = await CampanhaDestinatarioModel.findAll({
    where: {
      status: "enviado",
      resposta_1_wa_id: null,
      enviado_em: { [Op.ne]: null, [Op.lt]: limite },
    },
    attributes: ["id", "pessoa_id"],
    limit: 400,
  });

  for (const row of candidatos) {
    const pessoaId = Number(row.pessoa_id);
    if (!pessoaId) continue;

    const pessoa = await PessoaModel.findByPk(pessoaId, { attributes: ["id", "engajamentoWhatsapp"] });
    if (!pessoa) continue;

    const atual = String(pessoa.engajamentoWhatsapp || "sem_resposta");
    if (atual === "positivo" || atual === "negativo" || atual === "neutro") continue;

    const primeiroEnviado = await CampanhaDestinatarioModel.findOne({
      where: {
        pessoa_id: pessoaId,
        status: "enviado",
        enviado_em: { [Op.ne]: null },
      },
      order: [
        ["enviado_em", "ASC"],
        ["id", "ASC"],
      ],
      attributes: ["id"],
    });

    if (!primeiroEnviado || primeiroEnviado.id !== row.id) continue;

    await pessoa.update({ engajamentoWhatsapp: "sem_resposta" });
  }
}

function iniciarJobEngajamentoSemResposta() {
  const desabilitado = String(process.env.ENGAGAMENTO_SEM_RESPOSTA_JOB_DISABLED || "").trim() === "1";
  if (desabilitado) {
    console.log("[engajamento-job] Desabilitado (ENGAGAMENTO_SEM_RESPOSTA_JOB_DISABLED=1).");
    return;
  }

  const intervalo = Number(process.env.ENGAGAMENTO_SEM_RESPOSTA_JOB_MS || 10 * 60 * 1000);
  const tick = () => {
    executarMarcacaoSemRespostaPrimeiroContato().catch((e) =>
      console.error("[engajamento-job]", e?.message || e),
    );
  };

  setInterval(tick, Math.max(60_000, intervalo));
  setTimeout(tick, 20_000);
  console.log(
    `[engajamento-job] Ativo: primeiro contato sem resposta após ${obterJanelaMs() / 3600000}h (intervalo ${Math.max(60_000, intervalo)}ms).`,
  );
}

module.exports = {
  executarMarcacaoSemRespostaPrimeiroContato,
  iniciarJobEngajamentoSemResposta,
};
