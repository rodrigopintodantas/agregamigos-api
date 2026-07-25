"use strict";

module.exports = (sequelize, DataTypes) => {
  const GrupoPessoaModel = sequelize.define(
    "GrupoPessoaModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      grupo_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      pessoa_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      freezeTableName: true,
      tableName: "grupo_pessoa",
      timestamps: true,
    },
  );

  GrupoPessoaModel.associate = function (models) {
    GrupoPessoaModel.belongsTo(models.GrupoModel, {
      foreignKey: { name: "grupo_id", field: "grupo_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    GrupoPessoaModel.belongsTo(models.PessoaModel, {
      foreignKey: { name: "pessoa_id", field: "pessoa_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return GrupoPessoaModel;
};
