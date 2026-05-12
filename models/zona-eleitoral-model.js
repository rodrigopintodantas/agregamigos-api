"use strict";

module.exports = (sequelize, DataTypes) => {
  const ZonaEleitoralModel = sequelize.define(
    "ZonaEleitoralModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nrZona: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: "nr_zona",
      },
      nmZona: {
        type: DataTypes.STRING(500),
        allowNull: false,
        field: "nm_zona",
      },
    },
    { freezeTableName: true, tableName: "zonas_eleitorais", timestamps: true },
  );

  return ZonaEleitoralModel;
};
