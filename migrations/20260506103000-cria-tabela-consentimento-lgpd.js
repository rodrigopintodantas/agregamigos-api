"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("consentimento_lgpd", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
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
      termo_versao: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      termo_hash: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      aceito: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      aceito_em: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      origem: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      ip_origem: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.STRING(512),
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable("consentimento_lgpd");
  },
};
