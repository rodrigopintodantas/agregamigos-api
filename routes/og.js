"use strict";

const express = require("express");
const {
  buildLinkCadastroOgHtml,
  buscarOgMetaPorSlug,
  resolveWebOrigin,
  slugValido,
} = require("../utils/link-cadastro-og");

const router = express.Router();

router.get("/link-cadastro/:slugPublico", async (req, res, next) => {
  try {
    const slug = String(req.params.slugPublico ?? "").trim().toLowerCase();
    if (!slugValido(slug)) {
      return res.status(400).send("Slug de candidato invalido.");
    }

    const meta = await buscarOgMetaPorSlug(slug);
    if (!meta) {
      return res.status(404).send("Candidato nao encontrado.");
    }

    if (!meta.imagem_og) {
      return res.status(404).send("Previa nao configurada para este candidato.");
    }

    const origin = resolveWebOrigin(req);
    const queryString = String(req.url ?? "").includes("?")
      ? String(req.url).slice(String(req.url).indexOf("?") + 1)
      : "";

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300");
    return res.send(
      buildLinkCadastroOgHtml({
        origin,
        slug: meta.slug,
        nome: meta.nome,
        imagemOg: meta.imagem_og,
        queryString,
      }),
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
