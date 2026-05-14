const express = require("express");
const { sequelize, OuvidoriaModel } = require("../models");
const { authorize } = require("../auth/authorize");

const router = express.Router();
const apenasAdmin = authorize(["Administrador"]);

const CAMPOS_OUVIDORIA = [
  "dt_manifestacao",
  "fl_indicador",
  "ds_situacao",
  "ds_tipo",
  "ds_assunto",
  "ds_ra",
  "nm_orgao",
  "nm_secretaria",
  "ds_canal",
];

function normalizarCabecalhoCsv(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase();
}

function valor(rowMap, chave) {
  const k = normalizarCabecalhoCsv(chave);
  const v = rowMap[k];
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseBoolNullable(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === "true" || s === "1" || s === "sim") return true;
  if (s === "false" || s === "0" || s === "nao" || s === "não") return false;
  return null;
}

function parseDateTimeNullable(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;

  const brMatch = s.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!brMatch) return null;

  const [, dia, mes, ano, hora = "00", minuto = "00", segundo = "00"] = brMatch;
  const parsed = new Date(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rowMapDeRegistro(row) {
  const m = {};
  if (!row || typeof row !== "object") return m;
  for (const [key, val] of Object.entries(row)) {
    m[normalizarCabecalhoCsv(key)] = val;
  }
  return m;
}

function registroParaCreate(rowMap) {
  return {
    dtManifestacao: parseDateTimeNullable(valor(rowMap, "dt_manifestacao")),
    flIndicador: parseBoolNullable(valor(rowMap, "fl_indicador")),
    dsSituacao: valor(rowMap, "ds_situacao"),
    dsTipo: valor(rowMap, "ds_tipo"),
    dsAssunto: valor(rowMap, "ds_assunto"),
    dsRa: valor(rowMap, "ds_ra"),
    nmOrgao: valor(rowMap, "nm_orgao"),
    nmSecretaria: valor(rowMap, "nm_secretaria"),
    dsCanal: valor(rowMap, "ds_canal"),
  };
}

function serializar(v) {
  const j = v.get ? v.get({ plain: true }) : v;
  return {
    id: j.id,
    dt_manifestacao: j.dtManifestacao ? new Date(j.dtManifestacao).toISOString() : null,
    fl_indicador: j.flIndicador ?? null,
    ds_situacao: j.dsSituacao ?? null,
    ds_tipo: j.dsTipo ?? null,
    ds_assunto: j.dsAssunto ?? null,
    ds_ra: j.dsRa ?? null,
    nm_orgao: j.nmOrgao ?? null,
    nm_secretaria: j.nmSecretaria ?? null,
    ds_canal: j.dsCanal ?? null,
  };
}

router.get("/", apenasAdmin, async (req, res, next) => {
  try {
    const rows = await OuvidoriaModel.findAll({ order: [["id", "DESC"]] });
    return res.json(rows.map(serializar));
  } catch (err) {
    next(err);
  }
});

router.post("/importar-csv", apenasAdmin, async (req, res, next) => {
  try {
    const registros = Array.isArray(req.body?.registros) ? req.body.registros : [];
    if (!registros.length) {
      return res.status(400).json({ message: "Arquivo CSV sem registros válidos." });
    }

    const primeiraLinha = registros[0] && typeof registros[0] === "object" ? registros[0] : {};
    const chavesArquivo = new Set(Object.keys(primeiraLinha).map((k) => normalizarCabecalhoCsv(k)));
    const faltando = CAMPOS_OUVIDORIA.filter((h) => !chavesArquivo.has(h));
    if (faltando.length) {
      return res.status(400).json({
        message: `Dados inválidos: faltam campos obrigatórios: ${faltando.join(", ")}.`,
      });
    }

    const paraCriar = [];
    for (const item of registros) {
      const rowMap = rowMapDeRegistro(item);
      const row = registroParaCreate(rowMap);
      const temAlgumDado = CAMPOS_OUVIDORIA.some((c) => valor(rowMap, c) != null);
      if (!temAlgumDado) continue;
      paraCriar.push(row);
    }

    if (!paraCriar.length) {
      return res.status(400).json({ message: "Nenhuma linha com dados para importar." });
    }

    const CHUNK = 500;
    await sequelize.transaction(async (transaction) => {
      for (let i = 0; i < paraCriar.length; i += CHUNK) {
        const slice = paraCriar.slice(i, i + CHUNK);
        await OuvidoriaModel.bulkCreate(slice, { transaction });
      }
    });

    const inseridos = paraCriar.length;
    return res.status(201).json({
      message: `${inseridos} manifestação(ões) adicionada(s) à base, sem remover os registros já existentes.`,
      inseridos,
      ignorados: 0,
      total: inseridos,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
