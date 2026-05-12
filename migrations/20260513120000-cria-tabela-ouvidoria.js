"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ouvidoria", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      dt_manifestacao: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      fl_indicador: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },
      ds_situacao: {
        type: Sequelize.STRING(160),
        allowNull: true,
      },
      ds_tipo: {
        type: Sequelize.STRING(80),
        allowNull: true,
      },
      ds_assunto: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      ds_ra: {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
      nm_orgao: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      nm_secretaria: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      ds_canal: {
        type: Sequelize.STRING(40),
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
    await queryInterface.dropTable("ouvidoria");
  },
};
