"use strict";

module.exports = (sequelize, DataTypes) => {
  const ConsentimentoLgpdModel = sequelize.define(
    "ConsentimentoLgpdModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      pessoa_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "pessoa_id",
      },
      termo_versao: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: "termo_versao",
      },
      termo_hash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        field: "termo_hash",
      },
      aceito: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      aceito_em: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "aceito_em",
      },
      origem: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      ip_origem: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: "ip_origem",
      },
      user_agent: {
        type: DataTypes.STRING(512),
        allowNull: true,
        field: "user_agent",
      },
    },
    {
      freezeTableName: true,
      tableName: "consentimento_lgpd",
      timestamps: true,
    },
  );

  ConsentimentoLgpdModel.associate = function (models) {
    ConsentimentoLgpdModel.belongsTo(models.PessoaModel, {
      foreignKey: { name: "pessoa_id", field: "pessoa_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return ConsentimentoLgpdModel;
};
