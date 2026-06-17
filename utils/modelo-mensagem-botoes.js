"use strict";

const TIPO_TEXTO = "texto";
const TIPO_BOTOES = "botoes";
const MAX_BOTOES = 3;
const MIN_BOTOES = 2;
const MAX_TEXTO_BOTAO = 20;

function normalizarTipoMensagem(raw) {
  const t = String(raw ?? TIPO_TEXTO).trim().toLowerCase();
  return t === TIPO_BOTOES ? TIPO_BOTOES : TIPO_TEXTO;
}

function normalizarOpcoesBotoes(raw) {
  if (raw == null) return [];
  const lista = Array.isArray(raw) ? raw : [];
  const vistos = new Set();
  const out = [];
  for (const item of lista) {
    const texto = String(item ?? "").trim();
    if (!texto) continue;
    const chave = texto.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(texto.slice(0, MAX_TEXTO_BOTAO));
    if (out.length >= MAX_BOTOES) break;
  }
  return out;
}

function validarModeloMensagemPayload({ tipo_mensagem, corpo, opcoes_botoes }) {
  const tipo = normalizarTipoMensagem(tipo_mensagem);
  const opcoes = normalizarOpcoesBotoes(opcoes_botoes);
  if (!String(corpo ?? "").trim()) {
    return { ok: false, message: "Informe o texto do modelo." };
  }
  if (tipo === TIPO_BOTOES) {
    if (opcoes.length < MIN_BOTOES) {
      return {
        ok: false,
        message: `Modelos com botoes exigem entre ${MIN_BOTOES} e ${MAX_BOTOES} opcoes.`,
      };
    }
    return { ok: true, tipo, opcoes };
  }
  if (opcoes.length) {
    return { ok: false, message: "Opcoes de botao so sao permitidas em modelos com botoes." };
  }
  return { ok: true, tipo, opcoes: null };
}

module.exports = {
  TIPO_TEXTO,
  TIPO_BOTOES,
  MAX_BOTOES,
  MIN_BOTOES,
  MAX_TEXTO_BOTAO,
  normalizarTipoMensagem,
  normalizarOpcoesBotoes,
  validarModeloMensagemPayload,
};
