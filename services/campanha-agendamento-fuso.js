"use strict";

/** Fuso usado para turnos manhã/tarde/noite e exibição de agendamento (Brasília). */
const FUSO_CAMPANHA = "America/Sao_Paulo";

const formatadorPartes = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_CAMPANHA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function partesEmFusoCampanha(date) {
  const d = date instanceof Date ? date : new Date(date);
  const map = {};
  for (const p of formatadorPartes.formatToParts(d)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Instante UTC correspondente a um horário civil em Brasília (sem horário de verão). */
function instanteEmFusoCampanha(year, month, day, hour, minute = 0, second = 0) {
  const candidatos = [3, 2, 4];
  for (const offsetH of candidatos) {
    const utc = new Date(Date.UTC(year, month - 1, day, hour + offsetH, minute, second));
    const p = partesEmFusoCampanha(utc);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    ) {
      return utc;
    }
  }
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, second));
}

function mesmoDiaEmFusoCampanha(a, b) {
  const pa = partesEmFusoCampanha(a);
  const pb = partesEmFusoCampanha(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

function adicionarDiasEmFusoCampanha(date, dias) {
  const p = partesEmFusoCampanha(date);
  return instanteEmFusoCampanha(p.year, p.month, p.day + dias, 12, 0, 0);
}

function turnoPorHoraEmFusoCampanha(date) {
  const { hour } = partesEmFusoCampanha(date);
  if (hour < 12) return "manha";
  if (hour < 18) return "tarde";
  return "noite";
}

function baseTurnoEmFusoCampanha(diaReferencia, turno) {
  const p = partesEmFusoCampanha(diaReferencia);
  const hour = turno === "manha" ? 8 : turno === "tarde" ? 13 : 19;
  return instanteEmFusoCampanha(p.year, p.month, p.day, hour, 0, 0);
}

module.exports = {
  FUSO_CAMPANHA,
  partesEmFusoCampanha,
  instanteEmFusoCampanha,
  mesmoDiaEmFusoCampanha,
  adicionarDiasEmFusoCampanha,
  turnoPorHoraEmFusoCampanha,
  baseTurnoEmFusoCampanha,
};
