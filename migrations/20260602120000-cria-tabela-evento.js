"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("evento", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      candidato_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "candidato",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      descricao: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      data_evento: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      local: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      token_cadastro: {
        type: Sequelize.STRING(24),
        allowNull: false,
        unique: true,
      },
      id_coordenador: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "usuario",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: "ativo",
      },
      total_inscritos: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.addIndex("evento", ["candidato_id"], {
      name: "idx_evento_candidato_id",
    });
    await queryInterface.addIndex("evento", ["token_cadastro"], {
      name: "idx_evento_token_cadastro",
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("evento");
  },
};
