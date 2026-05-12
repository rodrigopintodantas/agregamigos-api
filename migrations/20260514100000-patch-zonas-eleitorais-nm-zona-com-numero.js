"use strict";

/** Mesmo conteúdo de `20260513150100-cria-tabela-zonas-eleitorais.js` — nm_zona com prefixo "N - ". */
const ZONAS_DF = [
  [1, "1 - Brasília - Asa Sul"],
  [2, "2 - Paranoá / Varjão / Itapoã / Lago Norte"],
  [3, "3 - Taguatinga"],
  [4, "4 - Santa Maria"],
  [5, "5 - Sobradinho"],
  [6, "6 - Planaltina"],
  [8, "8 - Ceilândia Centro"],
  [9, "9 - Guará"],
  [10, "10 - Núcleo Bandeirante / Riacho Fundo / Park Way / Candangolândia"],
  [11, "11 - Cruzeiro / Sudoeste / Octogonal"],
  [13, "13 - Samambaia"],
  [14, "14 - Brasília - Asa Norte"],
  [15, "15 - Águas Claras"],
  [16, "16 - Ceilândia Norte / Brazlândia"],
  [17, "17 - Gama"],
  [18, "18 - Lago Sul / Jardim Botânico / São Sebastião"],
  [19, "19 - Taguatinga"],
  [20, "20 - Ceilândia Sul"],
  [21, "21 - Recanto das Emas"],
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const [nr_zona, nm_zona] of ZONAS_DF) {
      await queryInterface.sequelize.query(
        `UPDATE zonas_eleitorais SET nm_zona = :nm_zona, "updatedAt" = :updatedAt WHERE nr_zona = :nr_zona`,
        {
          replacements: { nm_zona, nr_zona, updatedAt: now },
        },
      );
    }
  },

  async down(queryInterface) {
    const ZONAS_SEM_PREFIXO = [
      [1, "Brasília - Asa Sul"],
      [2, "Paranoá / Varjão / Itapoã / Lago Norte"],
      [3, "Taguatinga"],
      [4, "Santa Maria"],
      [5, "Sobradinho"],
      [6, "Planaltina"],
      [8, "Ceilândia Centro"],
      [9, "Guará"],
      [10, "Núcleo Bandeirante / Riacho Fundo / Park Way / Candangolândia"],
      [11, "Cruzeiro / Sudoeste / Octogonal"],
      [13, "Samambaia"],
      [14, "Brasília - Asa Norte"],
      [15, "Águas Claras"],
      [16, "Ceilândia Norte / Brazlândia"],
      [17, "Gama"],
      [18, "Lago Sul / Jardim Botânico / São Sebastião"],
      [19, "Taguatinga"],
      [20, "Ceilândia Sul"],
      [21, "Recanto das Emas"],
    ];
    const now = new Date();
    for (const [nr_zona, nm_zona] of ZONAS_SEM_PREFIXO) {
      await queryInterface.sequelize.query(
        `UPDATE zonas_eleitorais SET nm_zona = :nm_zona, "updatedAt" = :updatedAt WHERE nr_zona = :nr_zona`,
        {
          replacements: { nm_zona, nr_zona, updatedAt: now },
        },
      );
    }
  },
};
