const express = require("express");
const bcrypt = require("bcryptjs");
const { Op, fn, col, where } = require("sequelize");
const { UsuarioModel, PapelModel } = require("../models");
const { authorize } = require("../auth/authorize");

const router = express.Router();

router.get("/papeis", authorize(["Administrador"]), async (req, res, next) => {
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

router.post("/", authorize(["Administrador"]), async (req, res, next) => {
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
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
