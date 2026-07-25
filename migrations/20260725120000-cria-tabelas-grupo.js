"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("grupo", {
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
      token_cadastro: {
        type: Sequelize.STRING(24),
        allowNull: false,
        unique: true,
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

    await queryInterface.addIndex("grupo", ["candidato_id"], {
      name: "idx_grupo_candidato_id",
    });
    await queryInterface.addIndex("grupo", ["token_cadastro"], {
      name: "idx_grupo_token_cadastro",
      unique: true,
    });

    await queryInterface.createTable("grupo_coordenador", {
      grupo_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: "grupo",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: "usuario",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
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

    await queryInterface.createTable("grupo_pessoa", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      grupo_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "grupo",
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

    await queryInterface.addIndex("grupo_pessoa", ["grupo_id", "pessoa_id"], {
      name: "idx_grupo_pessoa_unico",
      unique: true,
    });
    await queryInterface.addIndex("grupo_pessoa", ["pessoa_id"], {
      name: "idx_grupo_pessoa_pessoa_id",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("grupo_pessoa");
    await queryInterface.dropTable("grupo_coordenador");
    await queryInterface.dropTable("grupo");
  },
};
