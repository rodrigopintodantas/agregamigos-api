const { Op } = require("sequelize");
const {
  sequelize,
  GrupoCoordenadorModel,
  UsuarioModel,
  GrupoModel,
} = require("../models");

async function listarCoordenadoresResumoPorGrupoId(grupoId) {
  const rows = await GrupoCoordenadorModel.findAll({
    where: { grupo_id: grupoId },
    include: [
      {
        model: UsuarioModel,
        required: true,
        attributes: ["id", "nome"],
      },
    ],
    order: [[UsuarioModel, "nome", "ASC"]],
  });

  return rows
    .map((row) => row.UsuarioModel)
    .filter(Boolean)
    .map((u) => ({ id: u.id, nome: u.nome }));
}

async function idsCoordenadoresDoGrupo(grupoId) {
  const rows = await GrupoCoordenadorModel.findAll({
    where: { grupo_id: grupoId },
    attributes: ["usuario_id"],
    raw: true,
  });
  return rows.map((r) => Number(r.usuario_id)).filter((id) => Number.isInteger(id) && id > 0);
}

async function sincronizarCoordenadoresDoGrupo(grupoId, usuarioIds, transaction) {
  const ids = [...new Set(usuarioIds.filter((id) => Number.isInteger(id) && id > 0))];
  await GrupoCoordenadorModel.destroy({
    where: { grupo_id: grupoId },
    transaction,
  });
  if (!ids.length) return [];
  await GrupoCoordenadorModel.bulkCreate(
    ids.map((usuario_id) => ({ grupo_id: grupoId, usuario_id })),
    { transaction },
  );
  return ids;
}

async function listarGruposDisponiveis(candidatoId) {
  const rows = await GrupoModel.findAll({
    where: { candidatoId },
    attributes: ["id", "nome", "status"],
    order: [
      ["nome", "ASC"],
      ["id", "ASC"],
    ],
  });
  return rows.map((g) => ({
    id: g.id,
    nome: g.nome,
    status: g.status,
  }));
}

async function listarGruposPorCoordenadores(candidatoId, usuarioIds) {
  const map = new Map();
  const ids = [...new Set(usuarioIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return map;

  const rows = await GrupoCoordenadorModel.findAll({
    where: { usuario_id: { [Op.in]: ids } },
    include: [
      {
        model: GrupoModel,
        required: true,
        attributes: ["id", "nome", "status"],
        where: { candidatoId },
      },
    ],
  });

  for (const row of rows) {
    const uid = Number(row.usuario_id);
    const g = row.GrupoModel;
    if (!g) continue;
    if (!map.has(uid)) map.set(uid, []);
    map.get(uid).push({ id: g.id, nome: g.nome, status: g.status });
  }

  for (const [uid, lista] of map.entries()) {
    lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt"));
    map.set(uid, lista);
  }

  return map;
}

async function salvarGruposCoordenador(candidatoId, usuarioId, grupoIdsRaw) {
  const grupoIds = [
    ...new Set(
      (Array.isArray(grupoIdsRaw) ? grupoIdsRaw : [])
        .map((v) => Number(v))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];

  let gruposValidos = [];
  if (grupoIds.length) {
    gruposValidos = await GrupoModel.findAll({
      where: { id: grupoIds, candidatoId },
      attributes: ["id", "nome", "status"],
      order: [["nome", "ASC"]],
    });
    if (gruposValidos.length !== grupoIds.length) {
      const err = new Error("Um ou mais grupos sao invalidos para este candidato.");
      err.status = 400;
      throw err;
    }
  }

  const gruposDoCandidato = await GrupoModel.findAll({
    where: { candidatoId },
    attributes: ["id"],
  });
  const idsGruposCandidato = gruposDoCandidato.map((g) => g.id);

  await sequelize.transaction(async (transaction) => {
    if (idsGruposCandidato.length) {
      await GrupoCoordenadorModel.destroy({
        where: {
          usuario_id: usuarioId,
          grupo_id: { [Op.in]: idsGruposCandidato },
        },
        transaction,
      });
    }
    if (grupoIds.length) {
      await GrupoCoordenadorModel.bulkCreate(
        grupoIds.map((grupo_id) => ({ grupo_id, usuario_id: usuarioId })),
        { transaction },
      );
    }
  });

  return gruposValidos.map((g) => ({
    id: g.id,
    nome: g.nome,
    status: g.status,
  }));
}

module.exports = {
  listarCoordenadoresResumoPorGrupoId,
  idsCoordenadoresDoGrupo,
  sincronizarCoordenadoresDoGrupo,
  listarGruposDisponiveis,
  listarGruposPorCoordenadores,
  salvarGruposCoordenador,
};
