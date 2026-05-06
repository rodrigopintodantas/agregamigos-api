"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("campanha_destinatario", "turno", {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: "manha",
    });

    await queryInterface.addColumn("campanha_destinatario", "agendado_para", {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex("campanha_destinatario", ["campanha_id", "agendado_para"], {
      name: "idx_campanha_destinatario_agendado",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("campanha_destinatario", "idx_campanha_destinatario_agendado");
    await queryInterface.removeColumn("campanha_destinatario", "agendado_para");
    await queryInterface.removeColumn("campanha_destinatario", "turno");
  },
};
