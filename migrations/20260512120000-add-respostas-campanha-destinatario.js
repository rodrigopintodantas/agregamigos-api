"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("campanha_destinatario", "wa_message_id_envio", {
      type: Sequelize.STRING(80),
      allowNull: true,
    });

    await queryInterface.addColumn("campanha_destinatario", "resposta_1_texto", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn("campanha_destinatario", "resposta_1_em", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("campanha_destinatario", "resposta_1_wa_id", {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
    await queryInterface.addColumn("campanha_destinatario", "resposta_1_sentimento", {
      type: Sequelize.STRING(20),
      allowNull: true,
    });

    await queryInterface.addColumn("campanha_destinatario", "resposta_2_texto", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn("campanha_destinatario", "resposta_2_em", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("campanha_destinatario", "resposta_2_wa_id", {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
    await queryInterface.addColumn("campanha_destinatario", "resposta_2_sentimento", {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("campanha_destinatario", "resposta_2_sentimento");
    await queryInterface.removeColumn("campanha_destinatario", "resposta_2_wa_id");
    await queryInterface.removeColumn("campanha_destinatario", "resposta_2_em");
    await queryInterface.removeColumn("campanha_destinatario", "resposta_2_texto");
    await queryInterface.removeColumn("campanha_destinatario", "resposta_1_sentimento");
    await queryInterface.removeColumn("campanha_destinatario", "resposta_1_wa_id");
    await queryInterface.removeColumn("campanha_destinatario", "resposta_1_em");
    await queryInterface.removeColumn("campanha_destinatario", "resposta_1_texto");
    await queryInterface.removeColumn("campanha_destinatario", "wa_message_id_envio");
  },
};
