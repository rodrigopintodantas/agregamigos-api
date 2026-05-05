"use strict";

const bcrypt = require("bcryptjs");

module.exports = {
  async up(queryInterface) {
    const senhaHash = await bcrypt.hash("rodrigo321", 10);

    const [papeis] = await queryInterface.sequelize.query(
      "SELECT id FROM papel WHERE nome = 'Administrador' LIMIT 1",
    );
    const papelAdmin = papeis?.[0];
    if (!papelAdmin) {
      throw new Error("Papel 'Administrador' não encontrado.");
    }

    const [usuarios] = await queryInterface.sequelize.query(
      "SELECT id FROM usuario WHERE lower(login) = 'rodrigo' LIMIT 1",
    );
    const usuarioExistente = usuarios?.[0];

    if (usuarioExistente) {
      await queryInterface.sequelize.query(
        `
        UPDATE usuario
        SET nome = :nome,
            login = :login,
            senha_hash = :senha_hash,
            papel_id = :papel_id
        WHERE id = :id
        `,
        {
          replacements: {
            id: usuarioExistente.id,
            nome: "Rodrigo",
            login: "Rodrigo",
            senha_hash: senhaHash,
            papel_id: papelAdmin.id,
          },
        },
      );
      return;
    }

    await queryInterface.bulkInsert(
      "usuario",
      [
        {
          nome: "Rodrigo",
          login: "Rodrigo",
          data_nascimento: null,
          email: null,
          telefone: null,
          senha_hash: senhaHash,
          papel_id: papelAdmin.id,
        },
      ],
      {},
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query("DELETE FROM usuario WHERE lower(login) = 'rodrigo'");
  },
};
