"use strict";

const { PessoaModel } = require("../models");

/**
 * Regra: qualquer negativo → negativo; senão qualquer positivo → positivo;
 * senão neutro ou desconhecido → neutro.
 */
function engajamentoDasSentimentosRespondidos(s1, s2) {
  const norm = [];
  for (const raw of [s1, s2]) {
    const x = String(raw || "")
      .toLowerCase()
      .trim();
    if (!x) continue;
    if (x === "negativo") norm.push("negativo");
    else if (x === "positivo") norm.push("positivo");
    else if (x === "neutro" || x === "desconhecido") norm.push("neutro");
    else norm.push("neutro");
  }
  if (!norm.length) return null;
  if (norm.includes("negativo")) return "negativo";
  if (norm.includes("positivo")) return "positivo";
  return "neutro";
}

/**
 * Expressão SQL (PostgreSQL) com a mesma prioridade de {@link engajamentoDasSentimentosRespondidos}:
 * negativo > positivo > neutro (inclui desconhecido); sem sentimento → NULL.
 */
function sqlExprSentimentoConsolidadoDestinatario(prefix = "") {
  const p = prefix ? `${prefix}.` : "";
  return `(CASE
    WHEN ${p}resposta_1_sentimento = 'negativo' OR ${p}resposta_2_sentimento = 'negativo' THEN 'negativo'
    WHEN ${p}resposta_1_sentimento = 'positivo' OR ${p}resposta_2_sentimento = 'positivo' THEN 'positivo'
    WHEN NULLIF(TRIM(COALESCE(${p}resposta_1_sentimento, '')), '') IS NOT NULL
      OR NULLIF(TRIM(COALESCE(${p}resposta_2_sentimento, '')), '') IS NOT NULL THEN 'neutro'
    ELSE NULL
  END)`;
}

const ENGAJAMENTOS_VALIDOS = ["sem_resposta", "positivo", "negativo", "neutro"];

function normalizarEngajamentoManual(value) {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return ENGAJAMENTOS_VALIDOS.includes(v) ? v : null;
}

/**
 * Corrige manualmente o sentimento das respostas do destinatário na campanha
 * e recalcula o engajamento da pessoa.
 */
async function aplicarEngajamentoManualDestinatario(destinatarioId, engajamento, options = {}) {
  const id = Number(destinatarioId);
  const eng = normalizarEngajamentoManual(engajamento);
  if (!id || !eng) {
    const err = new Error("Engajamento inválido. Use: sem_resposta, positivo, negativo ou neutro.");
    err.status = 400;
    throw err;
  }

  const { CampanhaDestinatarioModel, CampanhaDivulgacaoModel } = require("../models");
  const { transaction: extTransaction } = options;

  const run = async (transaction) => {
    const dest = await CampanhaDestinatarioModel.findOne({
      where: { id },
      include: [
        {
          model: CampanhaDivulgacaoModel,
          required: true,
          attributes: ["id", "candidatoId"],
          ...(options.candidatoId ? { where: { candidatoId: options.candidatoId } } : {}),
        },
      ],
      transaction,
      lock: true,
    });
    if (!dest) return null;

    const temTexto1 = Boolean(String(dest.resposta_1_texto || "").trim());
    const temTexto2 = Boolean(String(dest.resposta_2_texto || "").trim());
    if (!temTexto1 && !temTexto2 && eng !== "sem_resposta") {
      const err = new Error("Não há resposta registrada nesta campanha para reclassificar.");
      err.status = 400;
      throw err;
    }

    const updatePayload = {};
    if (eng === "sem_resposta") {
      if (temTexto1) updatePayload.resposta_1_sentimento = null;
      if (temTexto2) updatePayload.resposta_2_sentimento = null;
    } else {
      if (temTexto1) updatePayload.resposta_1_sentimento = eng;
      if (temTexto2) updatePayload.resposta_2_sentimento = eng;
    }

    if (Object.keys(updatePayload).length) {
      await dest.update(updatePayload, { transaction });
      await dest.reload({ transaction });
    }

    if (eng === "sem_resposta") {
      await PessoaModel.update(
        { engajamentoWhatsapp: "sem_resposta" },
        { where: { id: dest.pessoa_id }, transaction },
      );
    } else {
      await atualizarEngajamentoPessoaDeRespostas(
        dest.pessoa_id,
        dest.resposta_1_sentimento,
        dest.resposta_2_sentimento,
        { transaction },
      );
    }

    return dest;
  };

  if (extTransaction) return run(extTransaction);
  const { sequelize } = require("../models");
  return sequelize.transaction(run);
}

async function atualizarEngajamentoPessoaDeRespostas(pessoaId, resposta1Sentimento, resposta2Sentimento, options = {}) {
  const id = Number(pessoaId);
  if (!id) return;
  const valor = engajamentoDasSentimentosRespondidos(resposta1Sentimento, resposta2Sentimento);
  if (!valor) return;
  const { transaction } = options;
  await PessoaModel.update(
    { engajamentoWhatsapp: valor },
    { where: { id }, ...(transaction ? { transaction } : {}) },
  );
}

function normalizarSentimentoResposta(s) {
  const x = String(s || "")
    .toLowerCase()
    .trim();
  if (x === "negativo") return "negativo";
  if (x === "positivo") return "positivo";
  if (!x) return null;
  return "neutro";
}

/** Textos de resposta exibidos no painel para o engajamento consolidado do destinatário. */
function textosRespostaParaEngajamentoPainel(r1, r2, s1, s2, engajamento) {
  const items = [
    { texto: String(r1 || "").trim(), sent: s1 },
    { texto: String(r2 || "").trim(), sent: s2 },
  ].filter((x) => x.texto);

  if (!items.length) return null;

  if (engajamento === "negativo") {
    const neg = items.filter((x) => normalizarSentimentoResposta(x.sent) === "negativo");
    return (neg.length ? neg : items).map((x) => x.texto).join(" · ");
  }
  if (engajamento === "positivo") {
    const pos = items.filter((x) => normalizarSentimentoResposta(x.sent) === "positivo");
    return (pos.length ? pos : items).map((x) => x.texto).join(" · ");
  }
  const neu = items.filter((x) => {
    const n = normalizarSentimentoResposta(x.sent);
    return n !== "negativo" && n !== "positivo";
  });
  return (neu.length ? neu : items).map((x) => x.texto).join(" · ");
}

module.exports = {
  engajamentoDasSentimentosRespondidos,
  sqlExprSentimentoConsolidadoDestinatario,
  textosRespostaParaEngajamentoPainel,
  normalizarEngajamentoManual,
  aplicarEngajamentoManualDestinatario,
  atualizarEngajamentoPessoaDeRespostas,
};
