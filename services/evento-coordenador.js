const { EventoCoordenadorModel, UsuarioModel } = require("../models");

async function listarCoordenadoresResumoPorEventoId(eventoId) {
  const rows = await EventoCoordenadorModel.findAll({
    where: { evento_id: eventoId },
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

async function idsCoordenadoresDoEvento(eventoId) {
  const rows = await EventoCoordenadorModel.findAll({
    where: { evento_id: eventoId },
    attributes: ["usuario_id"],
    raw: true,
  });
  return rows.map((r) => Number(r.usuario_id)).filter((id) => Number.isInteger(id) && id > 0);
}

async function sincronizarCoordenadoresDoEvento(eventoId, usuarioIds, transaction) {
  const ids = [...new Set(usuarioIds.filter((id) => Number.isInteger(id) && id > 0))];
  await EventoCoordenadorModel.destroy({
    where: { evento_id: eventoId },
    transaction,
  });
  if (!ids.length) return [];
  await EventoCoordenadorModel.bulkCreate(
    ids.map((usuario_id) => ({ evento_id: eventoId, usuario_id })),
    { transaction },
  );
  return ids;
}

module.exports = {
  listarCoordenadoresResumoPorEventoId,
  idsCoordenadoresDoEvento,
  sincronizarCoordenadoresDoEvento,
};
