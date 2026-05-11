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

module.exports = {
  engajamentoDasSentimentosRespondidos,
  atualizarEngajamentoPessoaDeRespostas,
};
