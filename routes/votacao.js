const express = require("express");
const { sequelize, VotacaoModel } = require("../models");
const { authorize } = require("../auth/authorize");

const router = express.Router();
const apenasAdmin = authorize(["Administrador"]);

const CABECALHOS_CSV = [
  "sg_uf",
  "nr_zona",
  "cd_cargo",
  "ds_cargo",
  "nr_candidato",
  "nm_candidato",
  "nm_urna_candidato",
  "sg_partido",
  "ds_composicao_coligacao",
  "nr_turno",
  "ds_sit_totalizacao",
  "nm_tipo_destinacao_votos",
  "dt_ult_totalizacao",
  "pc_votos_validos",
  "qt_votos_nom_validos",
  "qt_votos_concorrentes",
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

function parseIntNullable(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function parseDecimalNullable(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBigIntNullable(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\./g, "").replace(/\s/g, "");
  if (!s) return null;
  try {
    return String(BigInt(s));
  } catch {
    return null;
  }
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
  const sgUfRaw = valor(rowMap, "sg_uf");
  const sgUf = sgUfRaw != null ? String(sgUfRaw).toUpperCase().slice(0, 2) : null;

  return {
    sgUf,
    nrZona: parseIntNullable(valor(rowMap, "nr_zona")),
    cdCargo: parseIntNullable(valor(rowMap, "cd_cargo")),
    dsCargo: valor(rowMap, "ds_cargo"),
    nrCandidato: parseIntNullable(valor(rowMap, "nr_candidato")),
    nmCandidato: valor(rowMap, "nm_candidato"),
    nmUrnaCandidato: valor(rowMap, "nm_urna_candidato"),
    sgPartido: valor(rowMap, "sg_partido"),
    dsComposicaoColigacao: valor(rowMap, "ds_composicao_coligacao"),
    nrTurno: parseIntNullable(valor(rowMap, "nr_turno")),
    dsSitTotalizacao: valor(rowMap, "ds_sit_totalizacao"),
    nmTipoDestinacaoVotos: valor(rowMap, "nm_tipo_destinacao_votos"),
    dtUltTotalizacao: parseDateTimeNullable(valor(rowMap, "dt_ult_totalizacao")),
    pcVotosValidos: parseDecimalNullable(valor(rowMap, "pc_votos_validos")),
    qtVotosNomValidos: parseBigIntNullable(valor(rowMap, "qt_votos_nom_validos")),
    qtVotosConcorrentes: parseBigIntNullable(valor(rowMap, "qt_votos_concorrentes")),
  };
}

function serializar(v) {
  const j = v.get ? v.get({ plain: true }) : v;
  return {
    id: j.id,
    sg_uf: j.sgUf ?? null,
    nr_zona: j.nrZona ?? null,
    cd_cargo: j.cdCargo ?? null,
    ds_cargo: j.dsCargo ?? null,
    nr_candidato: j.nrCandidato ?? null,
    nm_candidato: j.nmCandidato ?? null,
    nm_urna_candidato: j.nmUrnaCandidato ?? null,
    sg_partido: j.sgPartido ?? null,
    ds_composicao_coligacao: j.dsComposicaoColigacao ?? null,
    nr_turno: j.nrTurno ?? null,
    ds_sit_totalizacao: j.dsSitTotalizacao ?? null,
    nm_tipo_destinacao_votos: j.nmTipoDestinacaoVotos ?? null,
    dt_ult_totalizacao: j.dtUltTotalizacao ? new Date(j.dtUltTotalizacao).toISOString() : null,
    pc_votos_validos: j.pcVotosValidos != null ? String(j.pcVotosValidos) : null,
    qt_votos_nom_validos: j.qtVotosNomValidos != null ? String(j.qtVotosNomValidos) : null,
    qt_votos_concorrentes: j.qtVotosConcorrentes != null ? String(j.qtVotosConcorrentes) : null,
  };
}

router.get("/", apenasAdmin, async (req, res, next) => {
  try {
    const rows = await VotacaoModel.findAll({ order: [["id", "DESC"]] });
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
    const faltando = CABECALHOS_CSV.filter((h) => !chavesArquivo.has(h));
    if (faltando.length) {
      return res.status(400).json({
        message: `CSV inválido: faltam colunas obrigatórias (use os nomes da tabela votacao): ${faltando.join(", ")}.`,
      });
    }

    const paraCriar = [];
    for (const item of registros) {
      const rowMap = rowMapDeRegistro(item);
      const row = registroParaCreate(rowMap);
      const temAlgumDado = CABECALHOS_CSV.some((c) => valor(rowMap, c) != null);
      if (!temAlgumDado) continue;
      paraCriar.push(row);
    }

    if (!paraCriar.length) {
      return res.status(400).json({ message: "Nenhuma linha com dados para importar." });
    }

    /** Cada planilha refere-se a uma única zona; várias linhas com o mesmo nr_zona são permitidas. */
    const zonasDistintasNoArquivo = new Set();
    for (const row of paraCriar) {
      if (row.nrZona != null && row.nrZona !== undefined) {
        zonasDistintasNoArquivo.add(Number(row.nrZona));
      }
    }

    if (zonasDistintasNoArquivo.size === 0) {
      return res.status(400).json({
        message:
          "Nenhuma linha com nr_zona informado. Indique a zona nas linhas da planilha (todas devem ser da mesma zona).",
      });
    }

    if (zonasDistintasNoArquivo.size > 1) {
      const lista = [...zonasDistintasNoArquivo].sort((a, b) => a - b);
      return res.status(400).json({
        message: `O arquivo contém mais de uma zona (${lista.join(", ")}). Envie uma planilha por zona eleitoral.`,
      });
    }

    const zonaArquivo = [...zonasDistintasNoArquivo][0];

    for (const row of paraCriar) {
      if (row.nrZona == null || row.nrZona === undefined) {
        row.nrZona = zonaArquivo;
      }
    }

    const jaExisteZona = await VotacaoModel.count({
      where: { nrZona: zonaArquivo },
    });
    if (jaExisteZona > 0) {
      return res.status(409).json({
        message: `A zona ${zonaArquivo} já possui dados importados. Remova-os na base antes de carregar esta planilha novamente, ou use outra zona.`,
      });
    }

    const CHUNK = 500;
    await sequelize.transaction(async (transaction) => {
      for (let i = 0; i < paraCriar.length; i += CHUNK) {
        const slice = paraCriar.slice(i, i + CHUNK);
        await VotacaoModel.bulkCreate(slice, { transaction });
      }
    });

    const inseridos = paraCriar.length;
    return res.status(201).json({
      message: `${inseridos} registro(s) da zona ${zonaArquivo} adicionado(s).`,
      inseridos,
      ignorados: 0,
      total: inseridos,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
