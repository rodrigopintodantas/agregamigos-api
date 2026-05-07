"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("campanha_destinatario", "falha_entrega", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addColumn("campanha_destinatario", "falha_codigo", {
      type: Sequelize.STRING(60),
      allowNull: true,
    });

    await queryInterface.addColumn("campanha_destinatario", "falha_em", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("campanha_destinatario", "falha_em");
    await queryInterface.removeColumn("campanha_destinatario", "falha_codigo");
    await queryInterface.removeColumn("campanha_destinatario", "falha_entrega");
  },
};
