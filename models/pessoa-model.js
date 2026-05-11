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
      idCoordenador: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "id_coordenador",
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
  };

  return PessoaModel;
};
