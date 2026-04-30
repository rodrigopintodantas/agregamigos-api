const express = require("express");
const bcrypt = require("bcryptjs");
const { col, fn, where } = require("sequelize");
const { authorizeSemPerfilSelecionado, authBearerLogin, getPapeisPorUsuario } = require("../auth/authorize");
const { signAccessToken } = require("../auth/jwt");
const { UsuarioModel } = require("../models");
const perfil = require("../auth/perfil");

const router = express.Router();

router.post("/login", async (req, res, next) => {
  try {
    const { login, senha } = req.body ?? {};
    const identificadorTrim = login != null ? String(login).trim() : "";
    const senhaStr = senha != null ? String(senha) : "";

    if (!identificadorTrim || !senhaStr) {
      return res.status(400).json({ message: "Informe login ou email e senha." });
    }

    const identificadorLower = identificadorTrim.toLowerCase();

    let usuario = await UsuarioModel.unscoped().findOne({
      where: where(fn("lower", col("login")), identificadorLower),
    });

    if (!usuario) {
      usuario = await UsuarioModel.unscoped().findOne({
        where: where(fn("lower", col("email")), identificadorLower),
      });
    }

    if (!usuario || !usuario.senha_hash) {
      return res.status(401).json({ message: "Login ou senha incorretos." });
    }

    const ok = await bcrypt.compare(senhaStr, usuario.senha_hash);
    if (!ok) {
      return res.status(401).json({ message: "Login ou senha incorretos." });
    }

    const up = await getPapeisPorUsuario(usuario);
    if (!up || up.length === 0) {
      return res.status(400).json({
        message: "O usuario nao possui papel no sistema.",
      });
    }

    const token = signAccessToken(usuario);
    return res.json({
      token,
      usuario: {
        id: usuario.id,
        login: usuario.login,
        nome: usuario.nome,
        email: usuario.email,
        telefone: usuario.telefone,
        dataNascimento: usuario.dataNascimento,
      },
      papeis: up,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", authorizeSemPerfilSelecionado());
router.get("/perfil", authBearerLogin(), perfil);

module.exports = router;
