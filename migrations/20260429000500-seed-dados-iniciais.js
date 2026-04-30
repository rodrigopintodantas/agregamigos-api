"use strict";

const bcrypt = require("bcryptjs");

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const senhaHashAdmin = await bcrypt.hash("admin", 10);

    await queryInterface.bulkInsert(
      "papel",
      [
        { nome: "Administrador", dashboard: "/admin", createdAt: now, updatedAt: now },
        { nome: "Usuario", dashboard: "/home", createdAt: now, updatedAt: now },
      ],
      {},
    );
    const [papeis] = await queryInterface.sequelize.query(
      "SELECT id, nome FROM papel WHERE nome IN ('Administrador', 'Usuario')",
    );
    const papelAdmin = papeis.find((p) => p.nome === "Administrador");

    await queryInterface.bulkInsert(
      "usuario",
      [
        {
          nome: "Administrador",
          login: "admin",
          data_nascimento: null,
          email: "admin@agregamigos.local",
          telefone: null,
          senha_hash: senhaHashAdmin,
          papel_id: papelAdmin.id,
        },
      ],
      {},
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query("DELETE FROM usuario WHERE login = 'admin'");
    await queryInterface.sequelize.query("DELETE FROM papel WHERE nome IN ('Administrador', 'Usuario')");
  },
};
