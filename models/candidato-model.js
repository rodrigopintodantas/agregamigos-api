"use strict";

module.exports = (sequelize, DataTypes) => {
  const CandidatoModel = sequelize.define(
    "CandidatoModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(80),
        allowNull: false,
        unique: true,
      },
      imagemOg: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "imagem_og",
      },
    },
    { freezeTableName: true, tableName: "candidato", timestamps: true },
  );

  CandidatoModel.associate = function (models) {
    CandidatoModel.belongsToMany(models.UsuarioModel, {
      through: models.UsuarioCandidatoModel,
      foreignKey: "candidato_id",
      otherKey: "usuario_id",
    });
    CandidatoModel.hasMany(models.PessoaModel, {
      foreignKey: { name: "candidatoId", field: "candidato_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
    CandidatoModel.hasMany(models.ModeloMensagemModel, {
      foreignKey: { name: "candidatoId", field: "candidato_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
    CandidatoModel.hasMany(models.CampanhaDivulgacaoModel, {
      foreignKey: { name: "candidatoId", field: "candidato_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
  };

  return CandidatoModel;
};
