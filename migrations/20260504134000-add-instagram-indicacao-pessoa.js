"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("pessoa", "instagram", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn("pessoa", "indicacao", {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("pessoa", "indicacao");
    await queryInterface.removeColumn("pessoa", "instagram");
  },
};
