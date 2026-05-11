"use strict";

module.exports = (sequelize, DataTypes) => {
  const CampanhaDestinatarioModel = sequelize.define(
    "CampanhaDestinatarioModel",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      campanha_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "campanha_id",
      },
      pessoa_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "pessoa_id",
      },
      modelo_mensagem_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "modelo_mensagem_id",
      },
      ordem: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      whatsapp: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      turno: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "manha",
      },
      agendado_para: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "agendado_para",
      },
      status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "pendente",
      },
      tentativas: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      enviado_em: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "enviado_em",
      },
      erro_ultimo: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "erro_ultimo",
      },
      falha_entrega: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "falha_entrega",
      },
      falha_codigo: {
        type: DataTypes.STRING(60),
        allowNull: true,
        field: "falha_codigo",
      },
      falha_em: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "falha_em",
      },
      wa_message_id_envio: {
        type: DataTypes.STRING(80),
        allowNull: true,
        field: "wa_message_id_envio",
      },
      resposta_1_texto: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "resposta_1_texto",
      },
      resposta_1_em: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "resposta_1_em",
      },
      resposta_1_wa_id: {
        type: DataTypes.STRING(80),
        allowNull: true,
        field: "resposta_1_wa_id",
      },
      resposta_1_sentimento: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: "resposta_1_sentimento",
      },
      resposta_2_texto: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "resposta_2_texto",
      },
      resposta_2_em: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "resposta_2_em",
      },
      resposta_2_wa_id: {
        type: DataTypes.STRING(80),
        allowNull: true,
        field: "resposta_2_wa_id",
      },
      resposta_2_sentimento: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: "resposta_2_sentimento",
      },
    },
    {
      freezeTableName: true,
      tableName: "campanha_destinatario",
      timestamps: true,
    },
  );

  CampanhaDestinatarioModel.associate = function (models) {
    CampanhaDestinatarioModel.belongsTo(models.CampanhaDivulgacaoModel, {
      foreignKey: { name: "campanha_id", field: "campanha_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    CampanhaDestinatarioModel.belongsTo(models.PessoaModel, {
      foreignKey: { name: "pessoa_id", field: "pessoa_id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    CampanhaDestinatarioModel.belongsTo(models.ModeloMensagemModel, {
      foreignKey: { name: "modelo_mensagem_id", field: "modelo_mensagem_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
  };

  return CampanhaDestinatarioModel;
};
