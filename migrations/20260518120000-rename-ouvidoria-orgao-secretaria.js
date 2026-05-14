"use strict";

/**
 * Renomeia colunas sem alterar dados:
 * nm_orgao → nm_setor
 * nm_secretaria → nm_orgao
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.renameColumn("ouvidoria", "nm_orgao", "nm_setor");
    await queryInterface.renameColumn("ouvidoria", "nm_secretaria", "nm_orgao");
  },

  async down(queryInterface) {
    await queryInterface.renameColumn("ouvidoria", "nm_orgao", "nm_secretaria");
    await queryInterface.renameColumn("ouvidoria", "nm_setor", "nm_orgao");
  },
};
