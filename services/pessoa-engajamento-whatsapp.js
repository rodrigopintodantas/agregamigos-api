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
  atualizarEngajamentoPessoaDeRespostas,
};
