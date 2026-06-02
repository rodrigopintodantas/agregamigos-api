const express = require("express");
const { QueryTypes } = require("sequelize");
const {
  sequelize,
  UsuarioCandidatoModel,
  UsuarioModel,
  PapelModel,
} = require("../models");
const { authorize, authBearerCandidatoObrigatorio } = require("../auth/authorize");

const router = express.Router();
const apenasAdmin = [authBearerCandidatoObrigatorio(), authorize(["Administrador"])];

async function listarCoordenadoresDoCandidato(candidatoId) {
  const vinculos = await UsuarioCandidatoModel.findAll({
    where: { candidato_id: candidatoId },
    include: [
      {
        model: UsuarioModel,
        required: true,
        attributes: ["id", "nome", "login", "email", "telefone"],
        include: [
          {
            model: PapelModel,
            required: true,
            attributes: [],
            where: { nome: "Coordenador" },
          },
        ],
      },
    ],
  });

  return vinculos
    .map((v) => v.UsuarioModel)
    .filter(Boolean)
    .map((u) => ({
      id: u.id,
      nome: u.nome,
      login: u.login ?? null,
      email: u.email ?? null,
      telefone: u.telefone ?? null,
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt"));
}

function mesesUltimosN(n) {
  const lista = [];
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const y = m.getFullYear();
    const mm = String(m.getMonth() + 1).padStart(2, "0");
    lista.push(`${y}-${mm}`);
  }
  return lista;
}

router.get("/painel", ...apenasAdmin, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const coordenadores = await listarCoordenadoresDoCandidato(candidatoId);
    const mapNome = new Map(coordenadores.map((c) => [c.id, c.nome]));

    const totaisRows = await sequelize.query(
      `
      SELECT
        COALESCE(p.id_coordenador, 0)::integer AS coordenador_id,
        COUNT(*)::integer AS total
      FROM pessoa p
      WHERE p.candidato_id = :cid
      GROUP BY COALESCE(p.id_coordenador, 0)
      `,
      { type: QueryTypes.SELECT, replacements: { cid: candidatoId } },
    );

    const mapTotais = new Map(
      totaisRows.map((r) => [Number(r.coordenador_id), Number(r.total || 0)]),
    );

    const semCoordenador = mapTotais.get(0) ?? 0;
    const coordenadoresPainel = coordenadores.map((c) => ({
      ...c,
      total_cadastros: mapTotais.get(c.id) ?? 0,
    }));

    if (semCoordenador > 0) {
      coordenadoresPainel.push({
        id: 0,
        nome: "Sem coordenador",
        login: null,
        email: null,
        telefone: null,
        total_cadastros: semCoordenador,
      });
    }

    const comparativo = [...coordenadoresPainel]
      .sort((a, b) => b.total_cadastros - a.total_cadastros || String(a.nome).localeCompare(String(b.nome), "pt"))
      .map((c) => ({
        coordenador_id: c.id,
        nome: c.nome,
        total: c.total_cadastros,
      }));

    const meses = mesesUltimosN(12);
    const mensalRows = await sequelize.query(
      `
      SELECT
        COALESCE(p.id_coordenador, 0)::integer AS coordenador_id,
        to_char(date_trunc('month', p."createdAt"), 'YYYY-MM') AS mes,
        COUNT(*)::integer AS total
      FROM pessoa p
      WHERE p.candidato_id = :cid
        AND p."createdAt" >= date_trunc('month', NOW()) - interval '11 months'
      GROUP BY COALESCE(p.id_coordenador, 0), date_trunc('month', p."createdAt")
      ORDER BY mes ASC
      `,
      { type: QueryTypes.SELECT, replacements: { cid: candidatoId } },
    );

    const mapMensal = new Map();
    for (const row of mensalRows) {
      const cidCoord = Number(row.coordenador_id);
      const mes = String(row.mes);
      if (!mapMensal.has(cidCoord)) mapMensal.set(cidCoord, new Map());
      mapMensal.get(cidCoord).set(mes, Number(row.total || 0));
    }

    const idsSeries = comparativo.map((c) => c.coordenador_id);
    const series = idsSeries.map((coordenadorId) => {
      const porMes = mapMensal.get(coordenadorId) ?? new Map();
      const totais = meses.map((mes) => porMes.get(mes) ?? 0);
      const nome =
        coordenadorId === 0
          ? "Sem coordenador"
          : mapNome.get(coordenadorId) ?? `Coordenador #${coordenadorId}`;
      return { coordenador_id: coordenadorId, nome, totais };
    });

    let maxY = 1;
    for (const s of series) {
      for (const v of s.totais) maxY = Math.max(maxY, v);
    }

    const totalCadastros = totaisRows.reduce((acc, r) => acc + Number(r.total || 0), 0);

    return res.json({
      totais: {
        cadastros: totalCadastros,
        coordenadores: coordenadores.length,
        com_cadastro: coordenadoresPainel.filter((c) => c.id !== 0 && c.total_cadastros > 0).length,
      },
      coordenadores: coordenadoresPainel,
      comparativo,
      evolucao_mensal: {
        meses,
        series,
        max_y: maxY,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
