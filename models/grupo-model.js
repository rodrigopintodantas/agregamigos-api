"use strict";

module.exports = (sequelize, DataTypes) => {
  const GrupoModel = sequelize.define(
    "GrupoModel",
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
      tableName: "grupo",
      timestamps: true,
    },
  );

  GrupoModel.associate = function (models) {
    GrupoModel.belongsTo(models.CandidatoModel, {
      foreignKey: { name: "candidatoId", field: "candidato_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    GrupoModel.belongsToMany(models.UsuarioModel, {
      through: models.GrupoCoordenadorModel,
      foreignKey: { name: "grupo_id", field: "grupo_id" },
      otherKey: { name: "usuario_id", field: "usuario_id" },
      as: "CoordenadoresModel",
    });
    GrupoModel.hasMany(models.GrupoPessoaModel, {
      foreignKey: { name: "grupo_id", field: "grupo_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    GrupoModel.belongsToMany(models.PessoaModel, {
      through: models.GrupoPessoaModel,
      foreignKey: { name: "grupo_id", field: "grupo_id" },
      otherKey: { name: "pessoa_id", field: "pessoa_id" },
      as: "PessoasModel",
    });
  };

  return GrupoModel;
};
