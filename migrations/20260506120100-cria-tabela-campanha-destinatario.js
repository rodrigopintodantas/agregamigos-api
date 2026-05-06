"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("campanha_destinatario", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      campanha_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "campanha_divulgacao",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      pessoa_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "pessoa",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      modelo_mensagem_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "modelo_mensagem",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      ordem: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      whatsapp: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: "pendente",
      },
      tentativas: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      enviado_em: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      erro_ultimo: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("campanha_destinatario", ["campanha_id", "ordem"], {
      name: "idx_campanha_destinatario_ordem",
    });
    await queryInterface.addIndex("campanha_destinatario", ["campanha_id", "status"], {
      name: "idx_campanha_destinatario_status",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("campanha_destinatario");
  },
};
