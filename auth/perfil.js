const Usuario = require("../models").UsuarioModel;
const Papel = require("../models").PapelModel;

module.exports = perfil;

async function perfil(req, res) {
  try {
    const usuario = await Usuario.findByPk(req.auth.UsuarioId, {
      include: [{ model: Papel, attributes: ["id", "nome", "dashboard"] }],
      attributes: ["id", "nome", "login", "email", "telefone", "dataNascimento"],
    });

    if (!usuario || !usuario.PapelModel) return res.status(200).send({});

    return res.status(200).send({
      usuario: {
        id: usuario.id,
        login: usuario.login,
        nome: usuario.nome,
        email: usuario.email,
        telefone: usuario.telefone,
        data_nascimento: usuario.dataNascimento,
      },
      papel: {
        id: usuario.PapelModel.id,
        nome: usuario.PapelModel.nome,
        dashboard: usuario.PapelModel.dashboard,
      },
    });
  } catch (err) {
    console.log(err);
    return res.status(400).send({
      message: "Ops... problemas ao recuperar dados do Usuario. " + err.message,
    });
  }
}
