"use strict";

module.exports = (sequelize, DataTypes) => {
  const PessoaModel = sequelize.define(
    "PessoaModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      dataNascimento: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "data_nascimento",
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      whatsapp: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      instagram: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      indicacao: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      erroWhatsapp: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "erro_whatsapp",
      },
      engajamentoWhatsapp: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "sem_resposta",
        field: "engajamento_whatsapp",
      },
      idCoordenador: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "id_coordenador",
      },
      candidatoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "candidato_id",
      },
    },
    { freezeTableName: true, tableName: "pessoa", timestamps: true },
  );

  PessoaModel.associate = function (models) {
    PessoaModel.hasOne(models.EnderecoModel, {
      foreignKey: { name: "PessoaModelId", field: "pessoa_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    PessoaModel.belongsTo(models.UsuarioModel, {
      foreignKey: { name: "idCoordenador", field: "id_coordenador" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    });
    PessoaModel.belongsTo(models.CandidatoModel, {
      foreignKey: { name: "candidatoId", field: "candidato_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
    PessoaModel.belongsToMany(models.GrupoModel, {
      through: models.GrupoPessoaModel,
      foreignKey: { name: "pessoa_id", field: "pessoa_id" },
      otherKey: { name: "grupo_id", field: "grupo_id" },
      as: "GruposModel",
    });
  };

  return PessoaModel;
};
