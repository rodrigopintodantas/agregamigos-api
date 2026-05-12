"use strict";

/** Regiões administrativas eleitorais do DF — nr_zona x nm_zona (texto com número da zona). */
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
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("zonas_eleitorais", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nr_zona: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
      },
      nm_zona: {
        type: Sequelize.STRING(500),
        allowNull: false,
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

    const now = new Date();
    await queryInterface.bulkInsert(
      "zonas_eleitorais",
      ZONAS_DF.map(([nr_zona, nm_zona]) => ({
        nr_zona,
        nm_zona,
        createdAt: now,
        updatedAt: now,
      })),
      {},
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("zonas_eleitorais");
  },
};
