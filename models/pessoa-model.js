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
    },
    { freezeTableName: true, tableName: "pessoa", timestamps: true },
  );

  PessoaModel.associate = function (models) {
    PessoaModel.hasOne(models.EnderecoModel, {
      foreignKey: { name: "PessoaModelId", field: "pessoa_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return PessoaModel;
};
