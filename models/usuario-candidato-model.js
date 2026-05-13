"use strict";

module.exports = (sequelize, DataTypes) => {
  const UsuarioCandidatoModel = sequelize.define(
    "UsuarioCandidatoModel",
    {
      usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        field: "usuario_id",
      },
      candidato_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        field: "candidato_id",
      },
    },
    {
      freezeTableName: true,
      tableName: "usuario_candidato",
      timestamps: true,
    },
  );

  UsuarioCandidatoModel.associate = function (models) {
    UsuarioCandidatoModel.belongsTo(models.UsuarioModel, {
      foreignKey: { name: "usuario_id", field: "usuario_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    UsuarioCandidatoModel.belongsTo(models.CandidatoModel, {
      foreignKey: { name: "candidato_id", field: "candidato_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return UsuarioCandidatoModel;
};
