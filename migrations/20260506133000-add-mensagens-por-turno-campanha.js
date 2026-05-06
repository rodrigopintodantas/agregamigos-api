"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("campanha_divulgacao", "mensagens_por_turno", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 2,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("campanha_divulgacao", "mensagens_por_turno");
  },
};
