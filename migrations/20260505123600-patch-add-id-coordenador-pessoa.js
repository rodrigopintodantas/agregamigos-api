"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("pessoa", "id_coordenador", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: "usuario",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("pessoa", "id_coordenador");
  },
};
