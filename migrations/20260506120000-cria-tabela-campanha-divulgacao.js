"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("campanha_divulgacao", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: "rascunho",
      },
      total_destinatarios: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      total_enviados: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "usuario",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable("campanha_divulgacao");
  },
};
