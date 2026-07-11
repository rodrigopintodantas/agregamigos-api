const express = require("express");
const bcrypt = require("bcryptjs");
const { Op, fn, col, where } = require("sequelize");
const { UsuarioModel, PapelModel, UsuarioCandidatoModel } = require("../models");
const { authorize, authBearerCandidatoObrigatorio } = require("../auth/authorize");
const {
  listarBairrosComPessoas,
  listarBairrosVinculadosPorCoordenadores,
  salvarBairrosCoordenador,
  normalizarBairro,
} = require("../services/coordenador-bairro");

const router = express.Router();
const apenasAdmin = [authBearerCandidatoObrigatorio(), authorize(["Administrador"])];

async function coordenadorDoCandidato(candidatoId, usuarioId) {
  const vinculo = await UsuarioCandidatoModel.findOne({
    where: { candidato_id: candidatoId, usuario_id: usuarioId },
    include: [
      {
        model: UsuarioModel,
        required: true,
        attributes: ["id"],
        include: [
          {
            model: PapelModel,
            required: true,
            attributes: ["nome"],
            where: { nome: "Coordenador" },
          },
        ],
      },
    ],
  });
  return Boolean(vinculo);
}

router.get("/", ...apenasAdmin, async (req, res, next) => {
  try {
    const vinculos = await UsuarioCandidatoModel.findAll({
      where: { candidato_id: req.auth.CandidatoId },
      include: [
        {
          model: UsuarioModel,
          required: true,
          attributes: ["id", "nome", "login"],
          where: where(fn("lower", col("login")), { [Op.ne]: "admin" }),
          include: [
            {
              model: PapelModel,
              required: true,
              attributes: ["id", "nome"],
            },
          ],
        },
      ],
    });

    const usuariosBase = vinculos
      .map((v) => {
        const u = v.UsuarioModel;
        if (!u?.PapelModel) return null;
        return {
          id: u.id,
          nome: u.nome,
          login: u.login,
          papel: {
            id: u.PapelModel.id,
            nome: u.PapelModel.nome,
          },
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt"));

    const coordenadorIds = usuariosBase
      .filter((usuario) => usuario.papel.nome === "Coordenador")
      .map((usuario) => usuario.id);
    const bairrosPorCoordenador = await listarBairrosVinculadosPorCoordenadores(
      req.auth.CandidatoId,
      coordenadorIds,
    );

    const usuarios = usuariosBase.map((usuario) => ({
      ...usuario,
      bairros:
        usuario.papel.nome === "Coordenador" ? (bairrosPorCoordenador.get(usuario.id) ?? []) : [],
    }));

    return res.json(usuarios);
  } catch (err) {
    next(err);
  }
});

router.get("/bairros-com-pessoas", ...apenasAdmin, async (req, res, next) => {
  try {
    const bairros = await listarBairrosComPessoas(req.auth.CandidatoId);
    return res.json(bairros);
  } catch (err) {
    next(err);
  }
});

router.get("/papeis", ...apenasAdmin, async (req, res, next) => {
  try {
    const papeis = await PapelModel.findAll({
      attributes: ["id", "nome", "dashboard"],
      order: [["nome", "ASC"]],
    });
    return res.json(papeis);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/bairros", ...apenasAdmin, async (req, res, next) => {
  try {
    const usuarioId = Number(req.params.id);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return res.status(400).json({ message: "Usuário inválido." });
    }

    const vinculo = await UsuarioCandidatoModel.findOne({
      where: { candidato_id: req.auth.CandidatoId, usuario_id: usuarioId },
    });
    if (!vinculo) {
      return res.status(404).json({ message: "Usuário não encontrado para este candidato." });
    }

    const ehCoord = await coordenadorDoCandidato(req.auth.CandidatoId, usuarioId);
    if (!ehCoord) {
      return res.status(400).json({ message: "Apenas coordenadores podem ter bairros vinculados." });
    }

    const raw = req.body?.bairros;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ message: "Informe a lista de bairros." });
    }

    const bairros = await salvarBairrosCoordenador(
      req.auth.CandidatoId,
      usuarioId,
      raw.map(normalizarBairro),
    );

    return res.json({
      message: "Bairros vinculados com sucesso.",
      bairros,
    });
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
});

router.post("/", ...apenasAdmin, async (req, res, next) => {
  try {
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const login = req.body?.login != null ? String(req.body.login).trim() : "";
    const senha = req.body?.senha != null ? String(req.body.senha) : "";
    const emailRaw = req.body?.email != null ? String(req.body.email).trim() : "";
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    const papelId = Number(req.body?.papel_id);

    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe nome com pelo menos 3 caracteres." });
    }
    if (login.length < 3) {
      return res.status(400).json({ message: "Informe login com pelo menos 3 caracteres." });
    }
    if (senha.length < 6) {
      return res.status(400).json({ message: "Informe senha com pelo menos 6 caracteres." });
    }
    if (!Number.isInteger(papelId) || papelId <= 0) {
      return res.status(400).json({ message: "Perfil inválido." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "E-mail inválido." });
    }

    const papel = await PapelModel.findByPk(papelId);
    if (!papel) {
      return res.status(400).json({ message: "Perfil não encontrado." });
    }

    const loginCriador = String(req.auth?.preferred_username || "").trim().toLowerCase();
    if (String(papel.nome) === "Administrador" && loginCriador !== "admin") {
      return res.status(403).json({ message: "Apenas o usuario admin pode criar outros administradores." });
    }

    const loginExistente = await UsuarioModel.unscoped().findOne({
      where: where(fn("lower", col("login")), login.toLowerCase()),
    });
    if (loginExistente) {
      return res.status(409).json({ message: "Já existe usuário com este login." });
    }

    if (email) {
      const emailExistente = await UsuarioModel.unscoped().findOne({
        where: {
          email: { [Op.ne]: null },
          [Op.and]: [where(fn("lower", col("email")), email)],
        },
      });
      if (emailExistente) {
        return res.status(409).json({ message: "Já existe usuário com este e-mail." });
      }
    }

    const senha_hash = await bcrypt.hash(senha, 10);
    const criado = await UsuarioModel.create({
      nome,
      login,
      email,
      telefone: null,
      dataNascimento: null,
      senha_hash,
      PapelModelId: papel.id,
    });

    await UsuarioCandidatoModel.create({
      usuario_id: criado.id,
      candidato_id: req.auth.CandidatoId,
    });

    return res.status(201).json({
      message: "Usuário criado com sucesso.",
      usuario: {
        id: criado.id,
        nome: criado.nome,
        login: criado.login,
        email: criado.email,
        papel: {
          id: papel.id,
          nome: papel.nome,
        },
        bairros: [],
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
