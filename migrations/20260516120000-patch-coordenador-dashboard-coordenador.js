"use strict";

/** Corrige URL do painel do papel Coordenador (evita /admin bloqueado pelo perfil). */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE papel SET dashboard = '/coordenador' WHERE nome = 'Coordenador'`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE papel SET dashboard = '/admin' WHERE nome = 'Coordenador'`,
    );
  },
};
