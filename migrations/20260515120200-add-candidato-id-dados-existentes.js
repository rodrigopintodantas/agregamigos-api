"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    await queryInterface.bulkInsert("candidato", [
      {
        id: 1,
        nome: "Piloto",
        slug: "piloto",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await queryInterface.sequelize.query(
      `
      INSERT INTO usuario_candidato (usuario_id, candidato_id, "createdAt", "updatedAt")
      SELECT u.id, 1, :now, :now
      FROM usuario u
      WHERE NOT EXISTS (
        SELECT 1 FROM usuario_candidato uc
        WHERE uc.usuario_id = u.id AND uc.candidato_id = 1
      )
    `,
      { replacements: { now } },
    );

    await queryInterface.addColumn("pessoa", "candidato_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "candidato", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });

    await queryInterface.addColumn("modelo_mensagem", "candidato_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "candidato", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });

    await queryInterface.addColumn("campanha_divulgacao", "candidato_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "candidato", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });

    await queryInterface.sequelize.query(
      `UPDATE pessoa SET candidato_id = 1 WHERE candidato_id IS NULL`,
    );
    await queryInterface.sequelize.query(
      `UPDATE modelo_mensagem SET candidato_id = 1 WHERE candidato_id IS NULL`,
    );
    await queryInterface.sequelize.query(
      `UPDATE campanha_divulgacao SET candidato_id = 1 WHERE candidato_id IS NULL`,
    );

    await queryInterface.sequelize.query(`ALTER TABLE pessoa ALTER COLUMN candidato_id SET NOT NULL`);
    await queryInterface.sequelize.query(
      `ALTER TABLE modelo_mensagem ALTER COLUMN candidato_id SET NOT NULL`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE campanha_divulgacao ALTER COLUMN candidato_id SET NOT NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("campanha_divulgacao", "candidato_id");
    await queryInterface.removeColumn("modelo_mensagem", "candidato_id");
    await queryInterface.removeColumn("pessoa", "candidato_id");
    await queryInterface.sequelize.query(`DELETE FROM usuario_candidato`);
    await queryInterface.sequelize.query(`DELETE FROM candidato`);
  },
};
