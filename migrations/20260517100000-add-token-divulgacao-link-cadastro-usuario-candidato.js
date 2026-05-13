"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("usuario_candidato", "token_divulgacao_cadastro", {
      type: Sequelize.STRING(24),
      allowNull: true,
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("usuario_candidato", "token_divulgacao_cadastro");
  },
};
