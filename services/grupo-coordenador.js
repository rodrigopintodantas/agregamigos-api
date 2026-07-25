const { GrupoCoordenadorModel, UsuarioModel } = require("../models");

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

module.exports = {
  listarCoordenadoresResumoPorGrupoId,
  idsCoordenadoresDoGrupo,
  sincronizarCoordenadoresDoGrupo,
};
