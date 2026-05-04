"use strict";

module.exports = (sequelize, DataTypes) => {
  const ModeloMensagemModel = sequelize.define(
    "ModeloMensagemModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      titulo: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      corpo: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "usuario_id",
      },
    },
    {
      freezeTableName: true,
      tableName: "modelo_mensagem",
      timestamps: true,
    },
  );

  return ModeloMensagemModel;
};
