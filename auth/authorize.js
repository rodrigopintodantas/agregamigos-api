const { PapelModel, UsuarioModel, UsuarioCandidatoModel, CandidatoModel } = require("../models");
const { verifyAccessToken } = require("./jwt");

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return null;
}

function temPermissao(userRoles = [], functionRoles = []) {
  if (userRoles.length === 0) return false;
  return userRoles.some((element) => functionRoles.indexOf(element) > -1);
}

async function attachBearerAuth(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ message: "Cabecalho Authorization nao informado." });
    return null;
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    res.status(401).json({ message: "Token invalido ou expirado." });
    return null;
  }

  const usuario = await UsuarioModel.findByPk(decoded.sub, {
    attributes: ["id", "login", "nome", "email", "telefone", "dataNascimento"],
    include: [{ model: PapelModel, attributes: ["nome"], required: false }],
  });
  if (!usuario) {
    res.status(401).json({ message: "Usuario nao encontrado." });
    return null;
  }

  const rawCid = decoded.candidato_id;
  const candidatoId =
    rawCid != null && rawCid !== "" ? Number(rawCid) : null;
  const candidatoSlugRaw =
    decoded.candidato_slug != null ? String(decoded.candidato_slug).trim().toLowerCase() : null;

  req.auth = {
    preferred_username: usuario.login,
    UsuarioId: usuario.id,
    CandidatoId:
      Number.isInteger(candidatoId) && candidatoId > 0 ? candidatoId : null,
    CandidatoSlug: candidatoSlugRaw && candidatoSlugRaw.length > 0 ? candidatoSlugRaw : null,
    PapelNome: usuario.PapelModel?.nome != null ? String(usuario.PapelModel.nome) : null,
  };

  return usuario;
}

function authorize(functionRoles = []) {
  if (typeof functionRoles === "string") functionRoles = [functionRoles];

  return async (req, res, next) => {
    try {
      const usuario = await attachBearerAuth(req, res);
      if (!usuario) return;

      const usuarioComPapel = await UsuarioModel.findByPk(usuario.id, {
        include: [{ model: PapelModel, attributes: ["id", "nome", "dashboard"] }],
      });
      if (!usuarioComPapel || !usuarioComPapel.PapelModel) {
        return res.status(400).json({ message: "Usuario sem papel associado." });
      }
      if (!temPermissao([usuarioComPapel.PapelModel.nome], functionRoles)) {
        return res.status(401).json({ message: "Usuario sem perfil." });
      }

      next();
    } catch (error) {
      console.error("Erro no middleware authorize:", error);
      return res.status(401).json({ message: "Nao autorizado." });
    }
  };
}

function authBearerLogin() {
  return async (req, res, next) => {
    try {
      const usuario = await attachBearerAuth(req, res);
      if (!usuario) return;
      next();
    } catch (error) {
      console.error("Erro no middleware authBearerLogin:", error);
      return res.status(401).json({ message: "Nao autorizado." });
    }
  };
}

function authBearerCandidatoObrigatorio() {
  return async (req, res, next) => {
    try {
      const usuario = await attachBearerAuth(req, res);
      if (!usuario) return;

      if (!req.auth.CandidatoId) {
        return res.status(403).json({ message: "Selecione um candidato para continuar." });
      }

      const vinculo = await UsuarioCandidatoModel.findOne({
        where: { usuario_id: usuario.id, candidato_id: req.auth.CandidatoId },
      });
      if (!vinculo) {
        return res.status(403).json({ message: "Sem acesso a este candidato." });
      }

      const cand = await CandidatoModel.findByPk(req.auth.CandidatoId, {
        attributes: ["id", "slug", "nome"],
      });
      if (!cand || !cand.slug) {
        return res.status(403).json({ message: "Candidato invalido." });
      }

      if (req.auth.CandidatoSlug && cand.slug !== req.auth.CandidatoSlug) {
        return res.status(403).json({ message: "Contexto de candidato inconsistente no token." });
      }
      if (!req.auth.CandidatoSlug) {
        req.auth.CandidatoSlug = cand.slug;
      }

      next();
    } catch (error) {
      console.error("Erro no middleware authBearerCandidatoObrigatorio:", error);
      return res.status(401).json({ message: "Nao autorizado." });
    }
  };
}

async function getPapeisPorUsuario(usuario) {
  const usuarioComPapel = await UsuarioModel.findByPk(usuario.id, {
    include: [{ model: PapelModel, attributes: ["id", "nome", "dashboard"] }],
  });
  if (!usuarioComPapel || !usuarioComPapel.PapelModel) return [];

  return [
    {
      id: usuarioComPapel.PapelModel.id,
      nome: usuarioComPapel.PapelModel.nome,
      descricao: null,
      dashboard: usuarioComPapel.PapelModel.dashboard,
    },
  ];
}

async function listarCandidatosDoUsuario(usuarioId) {
  const rows = await UsuarioCandidatoModel.findAll({
    where: { usuario_id: usuarioId },
    include: [
      {
        model: CandidatoModel,
        attributes: ["id", "nome", "slug"],
        required: true,
      },
    ],
  });
  const candidatos = rows
    .map((r) => r.CandidatoModel)
    .filter(Boolean)
    .sort((a, b) => String(a.nome).localeCompare(b.nome, "pt"));
  return candidatos.map((c) => ({
    id: c.id,
    nome: c.nome,
    slug: c.slug,
  }));
}

function authorizeSemPerfilSelecionado() {
  return async (req, res) => {
    try {
      const usuario = await attachBearerAuth(req, res);
      if (!usuario) return;

      const papeis = await getPapeisPorUsuario(usuario);
      if (!papeis || papeis.length === 0) {
        return res.status(400).json({ message: "O usuario nao possui papel no sistema." });
      }

      const candidatos = await listarCandidatosDoUsuario(usuario.id);

      return res.status(200).send({
        usuario: {
          id: usuario.id,
          login: usuario.login,
          nome: usuario.nome,
          email: usuario.email,
          telefone: usuario.telefone,
          dataNascimento: usuario.dataNascimento,
        },
        papeis,
        candidatos,
      });
    } catch (error) {
      console.error("Erro no middleware authorizeSemPerfilSelecionado:", error);
      return res.status(401).json({ message: "Nao autorizado." });
    }
  };
}

module.exports = {
  authorizeSemPerfilSelecionado,
  authorize,
  authBearerLogin,
  authBearerCandidatoObrigatorio,
  getPapeisPorUsuario,
  listarCandidatosDoUsuario,
  attachBearerAuth,
};
