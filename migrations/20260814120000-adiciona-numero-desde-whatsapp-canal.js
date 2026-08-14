"use strict";

/**
 * `numero_desde` marca quando o número atual passou a operar no canal.
 * Serve de base para a rampa de aquecimento (trocar o telefone reinicia a contagem).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tabela = await queryInterface.describeTable("whatsapp_canal");
    if (!tabela.numero_desde) {
      await queryInterface.addColumn("whatsapp_canal", "numero_desde", {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await queryInterface.sequelize.query(
        `UPDATE whatsapp_canal SET numero_desde = "createdAt" WHERE numero_desde IS NULL`,
      );
    }
  },

  async down(queryInterface) {
    const tabela = await queryInterface.describeTable("whatsapp_canal");
    if (tabela.numero_desde) {
      await queryInterface.removeColumn("whatsapp_canal", "numero_desde");
    }
  },
};
