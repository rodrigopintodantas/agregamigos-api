"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("pessoa", "engajamento_whatsapp", {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: "sem_resposta",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("pessoa", "engajamento_whatsapp");
  },
};
