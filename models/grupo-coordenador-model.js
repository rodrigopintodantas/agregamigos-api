"use strict";

module.exports = (sequelize, DataTypes) => {
  const GrupoCoordenadorModel = sequelize.define(
    "GrupoCoordenadorModel",
    {
      grupo_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      freezeTableName: true,
      tableName: "grupo_coordenador",
      timestamps: true,
    },
  );

  GrupoCoordenadorModel.associate = function (models) {
    GrupoCoordenadorModel.belongsTo(models.GrupoModel, {
      foreignKey: { name: "grupo_id", field: "grupo_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    GrupoCoordenadorModel.belongsTo(models.UsuarioModel, {
      foreignKey: { name: "usuario_id", field: "usuario_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return GrupoCoordenadorModel;
};
