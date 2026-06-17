"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("modelo_mensagem", "tipo_mensagem", {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: "texto",
    });
    await queryInterface.addColumn("modelo_mensagem", "opcoes_botoes", {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("modelo_mensagem", "opcoes_botoes");
    await queryInterface.removeColumn("modelo_mensagem", "tipo_mensagem");
  },
};
