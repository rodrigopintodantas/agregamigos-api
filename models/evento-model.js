"use strict";

module.exports = (sequelize, DataTypes) => {
  const EventoModel = sequelize.define(
    "EventoModel",
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
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      descricao: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      data_evento: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      local: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      token_cadastro: {
        type: DataTypes.STRING(24),
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "ativo",
      },
      total_inscritos: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      freezeTableName: true,
      tableName: "evento",
      timestamps: true,
    },
  );

  EventoModel.associate = function (models) {
    EventoModel.belongsTo(models.CandidatoModel, {
      foreignKey: { name: "candidatoId", field: "candidato_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    EventoModel.belongsToMany(models.UsuarioModel, {
      through: models.EventoCoordenadorModel,
      foreignKey: { name: "evento_id", field: "evento_id" },
      otherKey: { name: "usuario_id", field: "usuario_id" },
      as: "CoordenadoresModel",
    });
    EventoModel.hasMany(models.EventoPessoaModel, {
      foreignKey: { name: "evento_id", field: "evento_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return EventoModel;
};
