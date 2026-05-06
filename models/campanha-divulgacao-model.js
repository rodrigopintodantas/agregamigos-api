"use strict";

module.exports = (sequelize, DataTypes) => {
  const CampanhaDivulgacaoModel = sequelize.define(
    "CampanhaDivulgacaoModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "rascunho",
      },
      total_destinatarios: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      total_enviados: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "usuario_id",
      },
    },
    {
      freezeTableName: true,
      tableName: "campanha_divulgacao",
      timestamps: true,
    },
  );

  CampanhaDivulgacaoModel.associate = function (models) {
    CampanhaDivulgacaoModel.hasMany(models.CampanhaDestinatarioModel, {
      foreignKey: { name: "campanha_id", field: "campanha_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    CampanhaDivulgacaoModel.belongsTo(models.UsuarioModel, {
      foreignKey: { name: "usuario_id", field: "usuario_id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    });
  };

  return CampanhaDivulgacaoModel;
};
