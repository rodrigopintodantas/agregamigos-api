"use strict";

/**
 * Renomeia o candidato legado "Piloto" (slug piloto) para Michello Bueno / michello-bueno.
 * O id e candidato_id nas demais tabelas permanecem iguais.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE candidato
      SET nome = 'Michello Bueno',
          slug = 'michello-bueno',
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE slug = 'piloto'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE candidato
      SET nome = 'Piloto',
          slug = 'piloto',
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE slug = 'michello-bueno' AND nome = 'Michello Bueno'
    `);
  },
};
