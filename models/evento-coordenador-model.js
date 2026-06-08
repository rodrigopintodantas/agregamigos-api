"use strict";

module.exports = (sequelize, DataTypes) => {
  const EventoCoordenadorModel = sequelize.define(
    "EventoCoordenadorModel",
    {
      evento_id: {
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
      tableName: "evento_coordenador",
      timestamps: true,
    },
  );

  EventoCoordenadorModel.associate = function (models) {
    EventoCoordenadorModel.belongsTo(models.EventoModel, {
      foreignKey: { name: "evento_id", field: "evento_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    EventoCoordenadorModel.belongsTo(models.UsuarioModel, {
      foreignKey: { name: "usuario_id", field: "usuario_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return EventoCoordenadorModel;
};
