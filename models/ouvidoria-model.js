"use strict";

module.exports = (sequelize, DataTypes) => {
  const OuvidoriaModel = sequelize.define(
    "OuvidoriaModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      dtManifestacao: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "dt_manifestacao",
      },
      flIndicador: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        field: "fl_indicador",
      },
      dsSituacao: {
        type: DataTypes.STRING(160),
        allowNull: true,
        field: "ds_situacao",
      },
      dsTipo: {
        type: DataTypes.STRING(80),
        allowNull: true,
        field: "ds_tipo",
      },
      dsAssunto: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "ds_assunto",
      },
      dsRa: {
        type: DataTypes.STRING(200),
        allowNull: true,
        field: "ds_ra",
      },
      nmOrgao: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "nm_orgao",
      },
      nmSecretaria: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "nm_secretaria",
      },
      dsCanal: {
        type: DataTypes.STRING(40),
        allowNull: true,
        field: "ds_canal",
      },
    },
    { freezeTableName: true, tableName: "ouvidoria", timestamps: true },
  );

  return OuvidoriaModel;
};
