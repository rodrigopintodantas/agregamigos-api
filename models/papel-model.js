"use strict";

module.exports = (sequelize, DataTypes) => {
  const PapelModel = sequelize.define(
    "PapelModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      dashboard: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    { freezeTableName: true, tableName: "papel", timestamps: true },
  );

  PapelModel.associate = function (models) {
    PapelModel.hasMany(models.UsuarioModel, {
      foreignKey: { name: "PapelModelId", field: "papel_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
  };

  return PapelModel;
};
