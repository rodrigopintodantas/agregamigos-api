"use strict";

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classificação heurística por léxico (PT-BR). Retorna: positivo | negativo | neutro | desconhecido */
function classificarSentimento(textoBruto) {
  const t = normalizarTexto(textoBruto);
  if (!t) return "desconhecido";

  const negativos = [
    /^negativo[\s!.]*$/,
    /^nao[\s!.?,]*$/,
    /\bnao\b/,
    /\bcom certeza\b.*\bnao\b/,
    /\bnao quero\b/,
    /\bnao tenho interesse\b/,
    /\bnao me mande\b/,
    /\bpara de mandar\b/,
    /\bpare de mandar\b/,
    /\bpara com isso\b/,
    /\bremover\b.*\b(cadastro|lista|contato)\b/,
    /\bremova\b/,
    /\bcancela\b/,
    /\bspam\b/,
    /\bmuito\s+(chato|insistente)\b/,
    /\binsistente\b/,
    /\bchato\b/,
    /\borrivel\b/,
    /\bhorrivel\b/,
    /\bpior\b/,
    /\bprocesso\b/,
    /\badvogado\b/,
    /\bprocon\b/,
    /\blgpd\b/,
    /\bdenunci\b/,
    /\bbloquear\b/,
    /\bnunca\b.*\b(quero|pedi)\b/,
    /\bodeio\b/,
    /\bva embora\b/,
    /\bsai daqui\b/,
    /\bme tira\b/,
    /\bnao mande mais\b/,
  ];
  for (const re of negativos) {
    if (re.test(t)) return "negativo";
  }

  const positivos = [
    /^positivo[\s!.]*$/,
    /\bcom certeza\b/,
    /\bcom toda certeza\b/,
    /\bcertamente\b/,
    /\bsim\b/,
    /\bclaro\b/,
    /\bok\b/,
    /\bokay\b/,
    /\bpode\b/,
    /\bcombinad/,
    /\bshow\b/,
    /\btop\b/,
    /\bperfeito\b/,
    /\blegal\b/,
    /\bgostei\b/,
    /\binteressad/,
    /\bquero\b/,
    /\bmanda\b/,
    /\bmande\b/,
    /\bbeleza\b/,
    /\bblz\b/,
    /\botimo\b/,
    /\bmuito bom\b/,
    /\be certo\b/,
    /\bobrigad/,
    /\bconfirmo\b/,
    /\baceito\b/,
    /\bconcordo\b/,
    /\bfechado\b/,
    /\bta bom\b/,
    /\bestá bom\b/,
    /\besta bom\b/,
    /\bpor favor\b.*\b(manda|envia|mande|envie)\b/,
  ];
  for (const re of positivos) {
    if (re.test(t)) return "positivo";
  }

  const soSaudacao =
    /^(oi|ola|olá|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|ok\.?)[\s!.]*$/i.test(String(textoBruto || "").trim());
  if (soSaudacao || t.length <= 2) return "neutro";

  return "neutro";
}

module.exports = { classificarSentimento, normalizarTexto };
