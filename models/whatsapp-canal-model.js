"use strict";

module.exports = (sequelize, DataTypes) => {
  const WhatsappCanalModel = sequelize.define(
    "WhatsappCanalModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      candidatoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "candidato_id",
      },
      nome: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      numero: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "desconectado",
      },
    },
    {
      freezeTableName: true,
      tableName: "whatsapp_canal",
      timestamps: true,
    },
  );

  WhatsappCanalModel.associate = function (models) {
    WhatsappCanalModel.belongsTo(models.CandidatoModel, {
      foreignKey: { name: "candidatoId", field: "candidato_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    WhatsappCanalModel.hasMany(models.CampanhaDivulgacaoModel, {
      foreignKey: { name: "whatsapp_canal_id", field: "whatsapp_canal_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
  };

  return WhatsappCanalModel;
};
