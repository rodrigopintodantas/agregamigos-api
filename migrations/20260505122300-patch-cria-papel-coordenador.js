"use strict";

module.exports = {
  async up(queryInterface) {
    const [exists] = await queryInterface.sequelize.query(
      "SELECT id FROM papel WHERE nome = 'Coordenador' LIMIT 1",
    );

    if (exists?.length) return;

    const now = new Date();
    await queryInterface.bulkInsert(
      "papel",
      [
        {
          nome: "Coordenador",
          dashboard: "/coordenador",
          createdAt: now,
          updatedAt: now,
        },
      ],
      {},
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query("DELETE FROM papel WHERE nome = 'Coordenador'");
  },
};
