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

router.post("/alterar-senha", authBearerLogin(), async (req, res, next) => {
  try {
    const senhaAtual = req.body?.senha_atual != null ? String(req.body.senha_atual) : "";
    const senhaNova = req.body?.senha_nova != null ? String(req.body.senha_nova) : "";
    const senhaNovaConfirmacao =
      req.body?.senha_nova_confirmacao != null ? String(req.body.senha_nova_confirmacao) : "";

    if (!senhaAtual || !senhaNova || !senhaNovaConfirmacao) {
      return res.status(400).json({ message: "Informe senha atual, nova senha e confirmação." });
    }
    if (senhaNova.length < 6) {
      return res.status(400).json({ message: "A nova senha deve ter no mínimo 6 caracteres." });
    }
    if (senhaNova !== senhaNovaConfirmacao) {
      return res.status(400).json({ message: "A confirmação da nova senha não confere." });
    }

    const usuarioId = Number(req.auth?.UsuarioId);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const usuario = await UsuarioModel.unscoped().findByPk(usuarioId);
    if (!usuario || !usuario.senha_hash) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    const okSenhaAtual = await bcrypt.compare(senhaAtual, usuario.senha_hash);
    if (!okSenhaAtual) {
      return res.status(400).json({ message: "Senha atual incorreta." });
    }

    const mesmaSenha = await bcrypt.compare(senhaNova, usuario.senha_hash);
    if (mesmaSenha) {
      return res.status(400).json({ message: "A nova senha deve ser diferente da senha atual." });
    }

    const novaHash = await bcrypt.hash(senhaNova, 10);
    await usuario.update({ senha_hash: novaHash });

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
