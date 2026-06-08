"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("evento_coordenador", {
      evento_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: "evento",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: "usuario",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
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

    await queryInterface.sequelize.query(`
      INSERT INTO evento_coordenador (evento_id, usuario_id, "createdAt", "updatedAt")
      SELECT id, id_coordenador, NOW(), NOW()
      FROM evento
      WHERE id_coordenador IS NOT NULL
    `);

    await queryInterface.removeColumn("evento", "id_coordenador");
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn("evento", "id_coordenador", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: "usuario",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.sequelize.query(`
      UPDATE evento e
      SET id_coordenador = ec.usuario_id
      FROM (
        SELECT DISTINCT ON (evento_id) evento_id, usuario_id
        FROM evento_coordenador
        ORDER BY evento_id, usuario_id
      ) ec
      WHERE e.id = ec.evento_id
    `);

    await queryInterface.dropTable("evento_coordenador");
  },
};
