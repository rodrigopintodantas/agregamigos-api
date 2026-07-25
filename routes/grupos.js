const crypto = require("crypto");
const express = require("express");
const {
  sequelize,
  GrupoModel,
  GrupoPessoaModel,
  PessoaModel,
  EnderecoModel,
  UsuarioCandidatoModel,
  UsuarioModel,
  PapelModel,
  CandidatoModel,
} = require("../models");
const { authorize, authBearerCandidatoObrigatorio } = require("../auth/authorize");
const {
  sincronizarCoordenadoresDoGrupo,
} = require("../services/grupo-coordenador");

const router = express.Router();
const apenasAdmin = [authBearerCandidatoObrigatorio(), authorize(["Administrador"])];
const adminOuCoordenador = [
  authBearerCandidatoObrigatorio(),
  authorize(["Administrador", "Coordenador"]),
];

function ehCoordenador(req) {
  return String(req.auth?.PapelNome ?? "") === "Coordenador";
}

const includeCoordenadoresGrupo = [
  {
    model: UsuarioModel,
    as: "CoordenadoresModel",
    attributes: ["id", "nome"],
    through: { attributes: [] },
    required: false,
  },
];

function gerarTokenCadastroGrupo() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const buf = crypto.randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i += 1) s += chars[buf[i] % chars.length];
  return s;
}

async function gerarTokenCadastroUnico(transaction) {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const candidate = gerarTokenCadastroGrupo();
    const existe = await GrupoModel.findOne({
      where: { token_cadastro: candidate },
      attributes: ["id"],
      transaction,
    });
    if (!existe) return candidate;
  }
  throw new Error("Nao foi possivel gerar token unico para o grupo.");
}

function parseCoordenadorIds(body) {
  const raw = body?.id_coordenadores;
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .map((v) => Number(v))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
  }
  const single = body?.id_coordenador;
  if (single != null && single !== "") {
    const id = Number(single);
    if (Number.isInteger(id) && id > 0) return [id];
  }
  return [];
}

async function validarCoordenadorCandidato(candidatoId, idCoordenador) {
  const id = Number(idCoordenador);
  if (!Number.isInteger(id) || id <= 0) return false;
  const vinculo = await UsuarioCandidatoModel.findOne({
    where: { candidato_id: candidatoId, usuario_id: id },
    include: [
      {
        model: UsuarioModel,
        required: true,
        attributes: ["id"],
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
  return Boolean(vinculo);
}

async function validarCoordenadoresCandidato(candidatoId, ids) {
  if (!ids.length) return true;
  for (const id of ids) {
    const ok = await validarCoordenadorCandidato(candidatoId, id);
    if (!ok) return false;
  }
  return true;
}

function serializarCoordenadores(row) {
  const lista = row.CoordenadoresModel ?? [];
  return lista
    .map((u) => ({ id: u.id, nome: u.nome }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt"));
}

function serializarGrupoLista(row) {
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao ?? null,
    status: row.status,
    total_inscritos: row.total_inscritos ?? 0,
    token_cadastro: row.token_cadastro,
    coordenadores: serializarCoordenadores(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/coordenadores", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const vinculos = await UsuarioCandidatoModel.findAll({
      where: { candidato_id: candidatoId },
      include: [
        {
          model: UsuarioModel,
          required: true,
          attributes: ["id", "nome"],
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
    const coordenadores = vinculos
      .map((v) => v.UsuarioModel)
      .filter(Boolean)
      .map((u) => ({ id: u.id, nome: u.nome }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt"));
    return res.json({ coordenadores });
  } catch (err) {
    next(err);
  }
});

router.get("/", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const grupos = await GrupoModel.findAll({
      where: { candidatoId: req.auth.CandidatoId },
      include: includeCoordenadoresGrupo,
      order: [
        ["nome", "ASC"],
        ["id", "DESC"],
      ],
    });
    return res.json(grupos.map(serializarGrupoLista));
  } catch (err) {
    next(err);
  }
});

router.post("/", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const nome = String(req.body?.nome ?? "").trim();
    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe o nome do grupo com pelo menos 3 caracteres." });
    }

    const descricao =
      req.body?.descricao != null && String(req.body.descricao).trim()
        ? String(req.body.descricao).trim()
        : null;

    let idsCoordenadores = parseCoordenadorIds(req.body);
    if (ehCoordenador(req)) {
      const uid = Number(req.auth.UsuarioId);
      if (Number.isInteger(uid) && uid > 0 && !idsCoordenadores.includes(uid)) {
        idsCoordenadores = [...idsCoordenadores, uid];
      }
    }
    const coordsOk = await validarCoordenadoresCandidato(candidatoId, idsCoordenadores);
    if (!coordsOk) {
      return res.status(400).json({ message: "Um ou mais coordenadores sao invalidos para este candidato." });
    }

    const created = await sequelize.transaction(async (transaction) => {
      const token_cadastro = await gerarTokenCadastroUnico(transaction);
      const grupo = await GrupoModel.create(
        {
          candidatoId,
          nome,
          descricao,
          token_cadastro,
          status: "ativo",
          total_inscritos: 0,
        },
        { transaction },
      );
      await sincronizarCoordenadoresDoGrupo(grupo.id, idsCoordenadores, transaction);
      return grupo;
    });

    const completo = await GrupoModel.findByPk(created.id, {
      include: includeCoordenadoresGrupo,
    });

    return res.status(201).json({
      message: "Grupo criado com sucesso.",
      grupo: serializarGrupoLista(completo),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const grupo = await GrupoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
      include: [
        ...includeCoordenadoresGrupo,
        {
          model: CandidatoModel,
          attributes: ["id", "nome", "slug"],
          required: true,
        },
      ],
    });
    if (!grupo) {
      return res.status(404).json({ message: "Grupo nao encontrado." });
    }

    const inscricoes = await GrupoPessoaModel.findAll({
      where: { grupo_id: id },
      include: [
        {
          model: PessoaModel,
          required: true,
          attributes: ["id", "nome", "whatsapp", "email", "createdAt", "idCoordenador"],
          include: [
            { model: EnderecoModel, required: false, attributes: ["bairro", "cidade"] },
            {
              model: UsuarioModel,
              required: false,
              attributes: ["id", "nome"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const candidatoSlug = grupo.CandidatoModel?.slug ?? "";
    const linkPath = candidatoSlug
      ? `/${candidatoSlug}/link-cadastro?grupo=${encodeURIComponent(grupo.token_cadastro)}`
      : null;

    return res.json({
      ...serializarGrupoLista(grupo),
      candidato_slug: candidatoSlug,
      link_cadastro_path: linkPath,
      inscritos: inscricoes.map((row) => {
        const p = row.PessoaModel;
        const end = p?.EnderecoModel;
        const coord = p.UsuarioModel;
        return {
          id: p.id,
          nome: p.nome,
          whatsapp: p.whatsapp ?? null,
          email: p.email ?? null,
          bairro: end?.bairro ?? null,
          cidade: end?.cidade ?? null,
          coordenador_id: coord?.id ?? p.idCoordenador ?? null,
          coordenador_nome: coord?.nome ?? null,
          inscrito_em: row.createdAt,
          pessoa_cadastrada_em: p.createdAt,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const grupo = await GrupoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!grupo) {
      return res.status(404).json({ message: "Grupo nao encontrado." });
    }

    await grupo.destroy();
    return res.json({ message: "Grupo excluido com sucesso." });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/status", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status ?? "").trim().toLowerCase();
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }
    if (!["ativo", "encerrado"].includes(status)) {
      return res.status(400).json({ message: "Status invalido. Use: ativo ou encerrado." });
    }

    const grupo = await GrupoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!grupo) {
      return res.status(404).json({ message: "Grupo nao encontrado." });
    }

    await grupo.update({ status });
    return res.json({
      message: status === "encerrado" ? "Grupo encerrado." : "Grupo reativado.",
      status: grupo.status,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
