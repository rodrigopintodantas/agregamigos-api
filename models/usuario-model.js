"use strict";

module.exports = (sequelize, DataTypes) => {
  const UsuarioModel = sequelize.define(
    "UsuarioModel",
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
      login: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      dataNascimento: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "data_nascimento",
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      telefone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      senha_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "senha_hash",
      },
      PapelModelId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "papel_id",
      },
    },
    {
      freezeTableName: true,
      tableName: "usuario",
      timestamps: false,
      defaultScope: {
        attributes: { exclude: ["senha_hash"] },
      },
    },
  );

  UsuarioModel.associate = function (models) {
    UsuarioModel.belongsTo(models.PapelModel, {
      foreignKey: { name: "PapelModelId", field: "papel_id" },
      allowNull: false,
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
    UsuarioModel.hasMany(models.PessoaModel, {
      foreignKey: { name: "idCoordenador", field: "id_coordenador" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    });
    UsuarioModel.belongsToMany(models.CandidatoModel, {
      through: models.UsuarioCandidatoModel,
      foreignKey: "usuario_id",
      otherKey: "candidato_id",
    });
  };

  return UsuarioModel;
};
