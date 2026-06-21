"use strict";

const { CandidatoModel } = require("../models");

const CRAWLER_UA =
  /WhatsApp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|TelegramBot/i;

function slugValido(slug) {
  return typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function isSocialCrawler(userAgent) {
  return CRAWLER_UA.test(String(userAgent ?? ""));
}

function resolveWebOrigin(req) {
  const fromEnv = String(process.env.PUBLIC_WEB_ORIGIN ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const proto = String(req.get("x-forwarded-proto") ?? req.protocol ?? "https")
    .split(",")[0]
    .trim();
  const host = String(req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/$/, "");
}

function absolutizarUrl(origin, pathOrUrl) {
  const raw = String(pathOrUrl ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(origin ?? "").replace(/\/$/, "");
  if (!base) return raw;
  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildLinkCadastroOgHtml({ origin, slug, nome, imagemOg, queryString = "" }) {
  const qs = String(queryString ?? "").replace(/^\?/, "");
  const pagePath = `/${slug}/link-cadastro${qs ? `?${qs}` : ""}`;
  const pageUrl = absolutizarUrl(origin, pagePath);
  const imageUrl = absolutizarUrl(origin, imagemOg);
  const title = `Cadastro — ${nome}`;
  const description = `Preencha seus dados para se cadastrar na campanha de ${nome}.`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AgregaAmigos">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}">` : ""}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">` : ""}
  <meta http-equiv="refresh" content="0;url=${escapeHtml(pageUrl)}">
</head>
<body>
  <p><a href="${escapeHtml(pageUrl)}">${escapeHtml(title)}</a></p>
</body>
</html>`;
}

async function buscarOgMetaPorSlug(slugParam) {
  const slug = String(slugParam ?? "").trim().toLowerCase();
  if (!slugValido(slug)) return null;

  const candidato = await CandidatoModel.findOne({
    where: { slug },
    attributes: ["nome", "slug", "imagemOg"],
  });
  if (!candidato) return null;

  const nome = String(candidato.nome ?? "").trim() || slug;
  const imagemOg = String(candidato.imagemOg ?? "").trim();

  return {
    slug,
    nome,
    imagem_og: imagemOg || null,
    title: `Cadastro — ${nome}`,
    description: `Preencha seus dados para se cadastrar na campanha de ${nome}.`,
  };
}

module.exports = {
  isSocialCrawler,
  resolveWebOrigin,
  buildLinkCadastroOgHtml,
  buscarOgMetaPorSlug,
  slugValido,
};
