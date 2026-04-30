const { PapelModel, UsuarioModel } = require("../models");
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

async function getUsuarioDoToken(req, res) {
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
  });
  if (!usuario) {
    res.status(401).json({ message: "Usuario nao encontrado." });
    return null;
  }
  return usuario;
}

function authorize(functionRoles = []) {
  if (typeof functionRoles === "string") functionRoles = [functionRoles];

  return async (req, res, next) => {
    try {
      const usuario = await getUsuarioDoToken(req, res);
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

      req.auth = { preferred_username: usuario.login, UsuarioId: usuario.id };
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
      const usuario = await getUsuarioDoToken(req, res);
      if (!usuario) return;
      req.auth = { preferred_username: usuario.login, UsuarioId: usuario.id };
      next();
    } catch (error) {
      console.error("Erro no middleware authBearerLogin:", error);
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

function authorizeSemPerfilSelecionado() {
  return async (req, res) => {
    try {
      const usuario = await getUsuarioDoToken(req, res);
      if (!usuario) return;

      const papeis = await getPapeisPorUsuario(usuario);
      if (!papeis || papeis.length === 0) {
        return res.status(400).json({ message: "O usuario nao possui papel no sistema." });
      }

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
  getPapeisPorUsuario,
};
