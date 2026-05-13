const express = require("express");
const { fn, col, where } = require("sequelize");
const { CandidatoModel, UsuarioCandidatoModel } = require("../models");
const { authorize } = require("../auth/authorize");

const router = express.Router();

function slugValido(slug) {
  return typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function apenasUsuarioLoginAdmin(req, res, next) {
  const login = String(req.auth?.preferred_username ?? "")
    .trim()
    .toLowerCase();
  if (login !== "admin") {
    return res.status(403).json({ message: "Apenas o usuario admin pode criar candidatos." });
  }
  next();
}

/**
 * Cria candidato e vincula ao usuario autenticado (admin).
 * Nao exige candidato no JWT — usado na tela /selecionar-candidato.
 */
router.post("/", authorize(["Administrador"]), apenasUsuarioLoginAdmin, async (req, res, next) => {
  try {
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const slugRaw = req.body?.slug != null ? String(req.body.slug).trim().toLowerCase() : "";

    if (nome.length < 2) {
      return res.status(400).json({ message: "Informe o nome do candidato com pelo menos 2 caracteres." });
    }
    if (nome.length > 160) {
      return res.status(400).json({ message: "Nome do candidato muito longo (maximo 160 caracteres)." });
    }
    if (!slugValido(slugRaw)) {
      return res.status(400).json({
        message:
          "Slug invalido. Use apenas letras minusculas, numeros e hifens (ex.: leticia ou campanha-2026).",
      });
    }

    const existenteSlug = await CandidatoModel.findOne({
      where: { slug: slugRaw },
      attributes: ["id"],
    });
    if (existenteSlug) {
      return res.status(409).json({ message: "Ja existe um candidato com este slug." });
    }

    const existenteNome = await CandidatoModel.findOne({
      where: where(fn("lower", col("nome")), nome.toLowerCase()),
      attributes: ["id"],
    });
    if (existenteNome) {
      return res.status(409).json({ message: "Ja existe um candidato com este nome." });
    }

    const usuarioId = Number(req.auth?.UsuarioId);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return res.status(401).json({ message: "Usuario nao identificado." });
    }

    const candidato = await CandidatoModel.create({
      nome,
      slug: slugRaw,
    });

    await UsuarioCandidatoModel.findOrCreate({
      where: { usuario_id: usuarioId, candidato_id: candidato.id },
      defaults: {
        usuario_id: usuarioId,
        candidato_id: candidato.id,
      },
    });

    return res.status(201).json({
      candidato: {
        id: candidato.id,
        nome: candidato.nome,
        slug: candidato.slug,
      },
      message: "Candidato criado com sucesso.",
    });
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Slug ou nome ja cadastrado." });
    }
    next(err);
  }
});

module.exports = router;
