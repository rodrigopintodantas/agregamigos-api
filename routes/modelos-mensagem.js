const express = require("express");
const { ModeloMensagemModel } = require("../models");
const { authorize } = require("../auth/authorize");

const router = express.Router();
const apenasAdmin = authorize(["Administrador"]);

function payloadFromBody(body) {
  const titulo = body?.titulo != null ? String(body.titulo).trim() : "";
  const corpo = body?.corpo != null ? String(body.corpo).trim() : "";
  return { titulo, corpo };
}

function mapRow(m) {
  return {
    id: m.id,
    titulo: m.titulo,
    corpo: m.corpo,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

router.get("/", apenasAdmin, async (req, res, next) => {
  try {
    const rows = await ModeloMensagemModel.findAll({
      order: [
        ["updatedAt", "DESC"],
        ["id", "DESC"],
      ],
    });
    res.json(rows.map(mapRow));
  } catch (err) {
    next(err);
  }
});

router.post("/", apenasAdmin, async (req, res, next) => {
  try {
    const { titulo, corpo } = payloadFromBody(req.body);
    if (!titulo || !corpo) {
      return res.status(400).json({ message: "Informe titulo e corpo do modelo." });
    }
    const created = await ModeloMensagemModel.create({
      titulo,
      corpo,
      usuario_id: req.auth?.UsuarioId ?? null,
    });
    res.status(201).json(mapRow(created));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", apenasAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "ID invalido." });
    }
    const { titulo, corpo } = payloadFromBody(req.body);
    if (!titulo || !corpo) {
      return res.status(400).json({ message: "Informe titulo e corpo do modelo." });
    }
    const row = await ModeloMensagemModel.findByPk(id);
    if (!row) {
      return res.status(404).json({ message: "Modelo nao encontrado." });
    }
    await row.update({ titulo, corpo });
    await row.reload();
    res.json(mapRow(row));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", apenasAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "ID invalido." });
    }
    const row = await ModeloMensagemModel.findByPk(id);
    if (!row) {
      return res.status(404).json({ message: "Modelo nao encontrado." });
    }
    await row.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
