"use strict";

const { Op } = require("sequelize");
const { CampanhaDestinatarioModel, CampanhaDivulgacaoModel } = require("../models");
const { partesEmFusoCampanha, instanteEmFusoCampanha } = require("./campanha-agendamento-fuso");

function numeroEnvOuPadrao(nome, padrao, minimo = 0) {
  const bruto = Number(process.env[nome]);
  if (!Number.isFinite(bruto)) return padrao;
  return Math.max(minimo, Math.trunc(bruto));
}

function booleanoEnv(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto == null || String(bruto).trim() === "") return padrao;
  return !["0", "false", "nao", "não", "off"].includes(String(bruto).trim().toLowerCase());
}

/** Teto diário por número. `0` desativa a verificação (ritmo controlado manualmente). */
function limiteDiarioCanal() {
  return numeroEnvOuPadrao("WHATSAPP_LIMITE_DIARIO_MAX", 200, 0);
}

function inicioDoDiaEmFusoCampanha(referencia = new Date()) {
  const p = partesEmFusoCampanha(referencia);
  return instanteEmFusoCampanha(p.year, p.month, p.day, 0, 0, 0);
}

async function contarEnviosHojeDoCanal(canalId, referencia = new Date()) {
  const id = Number(canalId);
  if (!Number.isInteger(id) || id <= 0) return 0;

  return CampanhaDestinatarioModel.count({
    where: {
      status: "enviado",
      enviado_em: { [Op.gte]: inicioDoDiaEmFusoCampanha(referencia) },
    },
    include: [
      {
        model: CampanhaDivulgacaoModel,
        required: true,
        attributes: [],
        where: { whatsapp_canal_id: id },
      },
    ],
  });
}

/**
 * Verifica se o canal ainda pode enviar hoje.
 * @returns {Promise<{permitido: boolean, limite: number, enviados: number, restante: number}>}
 */
async function verificarLimiteDiarioCanal(canalId, referencia = new Date()) {
  const limite = limiteDiarioCanal();
  if (!limite) {
    return { permitido: true, limite: 0, enviados: 0, restante: Number.POSITIVE_INFINITY };
  }

  const enviados = await contarEnviosHojeDoCanal(canalId, referencia);
  return {
    permitido: enviados < limite,
    limite,
    enviados,
    restante: Math.max(0, limite - enviados),
  };
}

module.exports = {
  booleanoEnv,
  numeroEnvOuPadrao,
  inicioDoDiaEmFusoCampanha,
  limiteDiarioCanal,
  contarEnviosHojeDoCanal,
  verificarLimiteDiarioCanal,
};
