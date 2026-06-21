"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("candidato", "imagem_og", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE candidato
      SET imagem_og = '/og/delegada-karen.jpg',
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE slug = 'delegada-karen'
         OR LOWER(TRIM(nome)) = 'delegada karen'
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("candidato", "imagem_og");
  },
};
