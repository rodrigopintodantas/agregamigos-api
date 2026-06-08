"use strict";

module.exports = (sequelize, DataTypes) => {
  const EventoPessoaModel = sequelize.define(
    "EventoPessoaModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      evento_id: {
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
      tableName: "evento_pessoa",
      timestamps: true,
    },
  );

  EventoPessoaModel.associate = function (models) {
    EventoPessoaModel.belongsTo(models.EventoModel, {
      foreignKey: { name: "evento_id", field: "evento_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    EventoPessoaModel.belongsTo(models.PessoaModel, {
      foreignKey: { name: "pessoa_id", field: "pessoa_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return EventoPessoaModel;
};
