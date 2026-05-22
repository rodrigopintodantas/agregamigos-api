"use strict";

const { WhatsappCanalModel } = require("../models");

function formatarNumeroCanal(userJid) {
  if (!userJid) return null;
  const user = String(userJid).split(":")[0] || "";
  const digits = user.replace(/\D/g, "");
  return digits || null;
}

function statusParaBanco(estado) {
  const s = String(estado?.status || "desconectado");
  if (estado?.conectado) return "conectado";
  if (s === "aguardando_qr") return "aguardando_qr";
  if (s === "conectando" || s === "reconectando") return s;
  return "desconectado";
}

async function persistirEstadoCanal(canalId, estado) {
  const id = Number(canalId);
  if (!Number.isInteger(id) || id <= 0) return;
  const numero =
    estado?.conectado && estado?.numero
      ? formatarNumeroCanal(estado.numero)
      : estado?.conectado
        ? formatarNumeroCanal(estado.numero)
        : null;
  await WhatsappCanalModel.update(
    {
      status: statusParaBanco(estado),
      numero: estado?.conectado ? numero : null,
    },
    { where: { id } },
  );
}

module.exports = { persistirEstadoCanal, formatarNumeroCanal, statusParaBanco };
