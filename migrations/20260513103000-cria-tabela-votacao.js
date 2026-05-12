"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("votacao", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sg_uf: {
        type: Sequelize.STRING(2),
        allowNull: true,
      },
      nr_zona: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      cd_cargo: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      ds_cargo: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      nr_candidato: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      nm_candidato: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      nm_urna_candidato: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      sg_partido: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      ds_composicao_coligacao: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      nr_turno: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      ds_sit_totalizacao: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      nm_tipo_destinacao_votos: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      dt_ult_totalizacao: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      pc_votos_validos: {
        type: Sequelize.DECIMAL(12, 4),
        allowNull: true,
      },
      qt_votos_nom_validos: {
        type: Sequelize.BIGINT,
        allowNull: true,
      },
      qt_votos_concorrentes: {
        type: Sequelize.BIGINT,
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
    await queryInterface.dropTable("votacao");
  },
};
