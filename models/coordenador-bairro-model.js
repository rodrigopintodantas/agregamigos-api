"use strict";

module.exports = (sequelize, DataTypes) => {
  const CoordenadorBairroModel = sequelize.define(
    "CoordenadorBairroModel",
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
      bairro: {
        type: DataTypes.STRING(120),
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      freezeTableName: true,
      tableName: "coordenador_bairro",
      timestamps: true,
    },
  );

  CoordenadorBairroModel.associate = function (models) {
    CoordenadorBairroModel.belongsTo(models.UsuarioModel, {
      foreignKey: { name: "usuario_id", field: "usuario_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    CoordenadorBairroModel.belongsTo(models.CandidatoModel, {
      foreignKey: { name: "candidato_id", field: "candidato_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return CoordenadorBairroModel;
};
