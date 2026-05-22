"use strict";

/** @param {import('sequelize').QueryInterface} queryInterface */
/** @param {import('sequelize').Sequelize} Sequelize */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("whatsapp_canal", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      candidato_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "candidato", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      nome: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      numero: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: "desconectado",
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("whatsapp_canal", ["candidato_id"], {
      name: "idx_whatsapp_canal_candidato",
    });

    await queryInterface.addColumn("campanha_divulgacao", "whatsapp_canal_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "whatsapp_canal", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });

    const [candidatos] = await queryInterface.sequelize.query(
      `SELECT id FROM candidato ORDER BY id ASC`,
    );
    const now = new Date();
    for (const row of candidatos) {
      const candidatoId = Number(row.id);
      if (!Number.isInteger(candidatoId) || candidatoId <= 0) continue;

      await queryInterface.bulkInsert("whatsapp_canal", [
        {
          candidato_id: candidatoId,
          nome: "Principal",
          numero: null,
          status: "desconectado",
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    const [canais] = await queryInterface.sequelize.query(
      `SELECT id, candidato_id FROM whatsapp_canal`,
    );
    const canalPorCandidato = new Map(
      canais.map((c) => [Number(c.candidato_id), Number(c.id)]),
    );

    for (const [candidatoId, canalId] of canalPorCandidato) {
      await queryInterface.sequelize.query(
        `UPDATE campanha_divulgacao SET whatsapp_canal_id = :canalId WHERE candidato_id = :candidatoId AND whatsapp_canal_id IS NULL`,
        { replacements: { canalId, candidatoId } },
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("campanha_divulgacao", "whatsapp_canal_id");
    await queryInterface.dropTable("whatsapp_canal");
  },
};
