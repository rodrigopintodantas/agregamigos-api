"use strict";

module.exports = (sequelize, DataTypes) => {
  const EnderecoModel = sequelize.define(
    "EnderecoModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      PessoaModelId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: "pessoa_id",
      },
      cep: {
        type: DataTypes.STRING(8),
        allowNull: true,
      },
      logradouro: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      numero: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      complemento: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      bairro: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      cidade: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      uf: {
        type: DataTypes.STRING(2),
        allowNull: true,
      },
      ibge: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
    },
    { freezeTableName: true, tableName: "endereco", timestamps: true },
  );

  EnderecoModel.associate = function (models) {
    EnderecoModel.belongsTo(models.PessoaModel, {
      foreignKey: { name: "PessoaModelId", field: "pessoa_id" },
      allowNull: false,
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return EnderecoModel;
};
