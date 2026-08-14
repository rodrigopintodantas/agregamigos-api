"use strict";

/** A rampa de aquecimento automática foi removida: o ritmo passou a ser definido manualmente. */
module.exports = {
  async up(queryInterface) {
    const tabela = await queryInterface.describeTable("whatsapp_canal");
    if (tabela.numero_desde) {
      await queryInterface.removeColumn("whatsapp_canal", "numero_desde");
    }
  },

  async down(queryInterface, Sequelize) {
    const tabela = await queryInterface.describeTable("whatsapp_canal");
    if (!tabela.numero_desde) {
      await queryInterface.addColumn("whatsapp_canal", "numero_desde", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },
};
