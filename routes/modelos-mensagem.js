const express = require("express");
const { ModeloMensagemModel } = require("../models");
const { authorize, authBearerCandidatoObrigatorio } = require("../auth/authorize");
const {
  normalizarTipoMensagem,
  normalizarOpcoesBotoes,
  validarModeloMensagemPayload,
  TIPO_BOTOES,
} = require("../utils/modelo-mensagem-botoes");

const router = express.Router();
const apenasAdmin = [authBearerCandidatoObrigatorio(), authorize(["Administrador"])];

function payloadFromBody(body) {
  const titulo = body?.titulo != null ? String(body.titulo).trim() : "";
  const corpo = body?.corpo != null ? String(body.corpo).trim() : "";
  const tipo_mensagem = normalizarTipoMensagem(body?.tipo_mensagem);
  const opcoes_botoes =
    tipo_mensagem === TIPO_BOTOES ? normalizarOpcoesBotoes(body?.opcoes_botoes) : null;
  return { titulo, corpo, tipo_mensagem, opcoes_botoes };
}

function mapRow(m) {
  const tipo = normalizarTipoMensagem(m.tipo_mensagem);
  return {
    id: m.id,
    titulo: m.titulo,
    corpo: m.corpo,
    tipo_mensagem: tipo,
    opcoes_botoes: tipo === TIPO_BOTOES ? normalizarOpcoesBotoes(m.opcoes_botoes) : [],
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

router.get("/", ...apenasAdmin, async (req, res, next) => {
  try {
    const rows = await ModeloMensagemModel.findAll({
      where: { candidatoId: req.auth.CandidatoId },
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

router.post("/", ...apenasAdmin, async (req, res, next) => {
  try {
    const payload = payloadFromBody(req.body);
    if (!payload.titulo) {
      return res.status(400).json({ message: "Informe titulo do modelo." });
    }
    const validacao = validarModeloMensagemPayload(payload);
    if (!validacao.ok) {
      return res.status(400).json({ message: validacao.message });
    }
    const created = await ModeloMensagemModel.create({
      titulo: payload.titulo,
      corpo: payload.corpo,
      tipo_mensagem: validacao.tipo,
      opcoes_botoes: validacao.opcoes,
      usuario_id: req.auth?.UsuarioId ?? null,
      candidatoId: req.auth.CandidatoId,
    });
    res.status(201).json(mapRow(created));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "ID invalido." });
    }
    const payload = payloadFromBody(req.body);
    if (!payload.titulo) {
      return res.status(400).json({ message: "Informe titulo do modelo." });
    }
    const validacao = validarModeloMensagemPayload(payload);
    if (!validacao.ok) {
      return res.status(400).json({ message: validacao.message });
    }
    const row = await ModeloMensagemModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!row) {
      return res.status(404).json({ message: "Modelo nao encontrado." });
    }
    await row.update({
      titulo: payload.titulo,
      corpo: payload.corpo,
      tipo_mensagem: validacao.tipo,
      opcoes_botoes: validacao.opcoes,
    });
    await row.reload();
    res.json(mapRow(row));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "ID invalido." });
    }
    const row = await ModeloMensagemModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
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
