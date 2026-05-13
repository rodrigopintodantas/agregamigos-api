"use strict";

const jwt = require("jsonwebtoken");

function getSecret() {
  return process.env.JWT_SECRET || "agregamigos-dev-secret-altere-em-producao";
}

function signAccessToken(usuario, candidato) {
  const payload = {
    sub: usuario.id,
    login: usuario.login,
  };
  if (candidato && candidato.id != null) {
    const cid = Number(candidato.id);
    if (Number.isInteger(cid) && cid > 0) {
      payload.candidato_id = cid;
    }
    if (candidato.slug) {
      payload.candidato_slug = String(candidato.slug).trim().toLowerCase();
    }
  }
  return jwt.sign(payload, getSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
}

function verifyAccessToken(token) {
  return jwt.verify(token, getSecret());
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
