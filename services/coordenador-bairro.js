const { Op, QueryTypes } = require("sequelize");
const { sequelize, CoordenadorBairroModel } = require("../models");

function normalizarBairro(value) {
  return String(value ?? "").trim();
}

async function listarBairrosVinculados(candidatoId, usuarioId) {
  const rows = await CoordenadorBairroModel.findAll({
    where: { candidato_id: candidatoId, usuario_id: usuarioId },
    attributes: ["bairro"],
    order: [["bairro", "ASC"]],
  });
  return rows.map((row) => row.bairro);
}

async function listarBairrosVinculadosPorCoordenadores(candidatoId, usuarioIds) {
  const map = new Map();
  const ids = [...new Set(usuarioIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return map;

  const rows = await CoordenadorBairroModel.findAll({
    where: {
      candidato_id: candidatoId,
      usuario_id: { [Op.in]: ids },
    },
    attributes: ["usuario_id", "bairro"],
    order: [["bairro", "ASC"]],
  });

  for (const row of rows) {
    if (!map.has(row.usuario_id)) {
      map.set(row.usuario_id, []);
    }
    map.get(row.usuario_id).push(row.bairro);
  }

  return map;
}

async function listarBairrosComPessoas(candidatoId) {
  const rows = await sequelize.query(
    `
    SELECT TRIM(e.bairro) AS bairro, COUNT(*)::integer AS quantidade
    FROM endereco e
    INNER JOIN pessoa p ON p.id = e.pessoa_id
    WHERE p.candidato_id = :cid
      AND e.bairro IS NOT NULL AND TRIM(e.bairro) <> ''
    GROUP BY TRIM(e.bairro)
    ORDER BY TRIM(e.bairro) ASC
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { cid: candidatoId },
    },
  );

  return rows.map((row) => ({
    bairro: row.bairro,
    quantidade: Number(row.quantidade),
  }));
}

async function salvarBairrosCoordenador(candidatoId, usuarioId, bairrosRaw) {
  const bairros = [...new Set(bairrosRaw.map(normalizarBairro).filter(Boolean))];
  const disponiveis = await listarBairrosComPessoas(candidatoId);
  const setDisponiveis = new Set(disponiveis.map((item) => item.bairro));
  const invalidos = bairros.filter((bairro) => !setDisponiveis.has(bairro));

  if (invalidos.length) {
    const err = new Error("Bairro inválido ou sem pessoas cadastradas neste candidato.");
    err.status = 400;
    throw err;
  }

  await sequelize.transaction(async (transaction) => {
    await CoordenadorBairroModel.destroy({
      where: { candidato_id: candidatoId, usuario_id: usuarioId },
      transaction,
    });

    if (bairros.length) {
      await CoordenadorBairroModel.bulkCreate(
        bairros.map((bairro) => ({
          usuario_id: usuarioId,
          candidato_id: candidatoId,
          bairro,
        })),
        { transaction },
      );
    }
  });

  return bairros;
}

async function wherePessoasListagemCoordenador(candidatoId, usuarioId) {
  const bairros = await listarBairrosVinculados(candidatoId, usuarioId);
  if (!bairros.length) {
    return { candidatoId, idCoordenador: usuarioId };
  }

  const bairrosSql = bairros.map((bairro) => sequelize.escape(bairro)).join(", ");

  return {
    candidatoId,
    [Op.or]: [
      { idCoordenador: usuarioId },
      sequelize.literal(`EXISTS (
        SELECT 1 FROM endereco e
        WHERE e.pessoa_id = "PessoaModel"."id"
          AND TRIM(e.bairro) IN (${bairrosSql})
      )`),
    ],
  };
}

function sqlFiltroCoordenadorPessoas(usuarioId, bairros) {
  if (!bairros.length) {
    return {
      sql: " AND p.id_coordenador = :uid ",
      replacements: { uid: usuarioId },
    };
  }

  return {
    sql: " AND (p.id_coordenador = :uid OR TRIM(e.bairro) IN (:bairros)) ",
    replacements: { uid: usuarioId, bairros },
  };
}

async function listarDistribuicaoPessoasPorCoordenador(candidatoId) {
  const rows = await sequelize.query(
    `
    SELECT
      u.id AS coordenador_id,
      u.nome,
      COUNT(DISTINCT p.id)::integer AS total
    FROM usuario_candidato uc
    INNER JOIN usuario u ON u.id = uc.usuario_id
    INNER JOIN papel pap ON pap.id = u.papel_id AND pap.nome = 'Coordenador'
    LEFT JOIN pessoa p ON p.candidato_id = uc.candidato_id
      AND (
        p.id_coordenador = u.id
        OR EXISTS (
          SELECT 1
          FROM coordenador_bairro cb
          INNER JOIN endereco e ON e.pessoa_id = p.id
          WHERE cb.usuario_id = u.id
            AND cb.candidato_id = uc.candidato_id
            AND TRIM(e.bairro) = TRIM(cb.bairro)
        )
      )
    WHERE uc.candidato_id = :cid
    GROUP BY u.id, u.nome
    ORDER BY total DESC, u.nome ASC
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { cid: candidatoId },
    },
  );

  const resultado = rows.map((row) => ({
    coordenador_id: Number(row.coordenador_id),
    nome: row.nome,
    total: Number(row.total || 0),
  }));

  return resultado;
}

module.exports = {
  listarBairrosVinculados,
  listarBairrosVinculadosPorCoordenadores,
  listarBairrosComPessoas,
  salvarBairrosCoordenador,
  wherePessoasListagemCoordenador,
  sqlFiltroCoordenadorPessoas,
  listarDistribuicaoPessoasPorCoordenador,
  normalizarBairro,
};
