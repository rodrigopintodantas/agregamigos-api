"use strict";

module.exports = (sequelize, DataTypes) => {
  const VotacaoModel = sequelize.define(
    "VotacaoModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sgUf: {
        type: DataTypes.STRING(2),
        allowNull: true,
        field: "sg_uf",
      },
      nrZona: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "nr_zona",
      },
      cdCargo: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "cd_cargo",
      },
      dsCargo: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "ds_cargo",
      },
      nrCandidato: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "nr_candidato",
      },
      nmCandidato: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "nm_candidato",
      },
      nmUrnaCandidato: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "nm_urna_candidato",
      },
      sgPartido: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "sg_partido",
      },
      dsComposicaoColigacao: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "ds_composicao_coligacao",
      },
      nrTurno: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "nr_turno",
      },
      dsSitTotalizacao: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "ds_sit_totalizacao",
      },
      nmTipoDestinacaoVotos: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "nm_tipo_destinacao_votos",
      },
      dtUltTotalizacao: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "dt_ult_totalizacao",
      },
      pcVotosValidos: {
        type: DataTypes.DECIMAL(12, 4),
        allowNull: true,
        field: "pc_votos_validos",
      },
      qtVotosNomValidos: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: "qt_votos_nom_validos",
      },
      qtVotosConcorrentes: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: "qt_votos_concorrentes",
      },
    },
    { freezeTableName: true, tableName: "votacao", timestamps: true },
  );

  return VotacaoModel;
};
