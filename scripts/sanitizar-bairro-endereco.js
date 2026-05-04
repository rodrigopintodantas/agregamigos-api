#!/usr/bin/env node
/**
 * Corrige valores da coluna `bairro` na tabela `endereco` conforme regras de normalização
 * (RA's do DF e variações de grafia).
 *
 * Uso (na pasta agregamigos-api):
 *   node scripts/sanitizar-bairro-endereco.js
 *   node scripts/sanitizar-bairro-endereco.js --dry-run
 */

"use strict";

process.env.NODE_ENV = process.env.NODE_ENV || "stage";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { Op } = require("sequelize");
const { EnderecoModel, sequelize } = require("../models");

/** Chave para casamento: sem acentos, minúsculas, espaços colapsados. */
function chaveNormalizada(s) {
  let t = String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[!.,;:]+$/g, "").trim();
  return t;
}

/** Grupos: valor canônico no banco -> variantes que devem virar esse valor. */
const GRUPOS = [
  [
    "Águas Claras",
    [
      "Águas Claras Norte",
      "Águas Claras DF",
      "Águas claras",
      "Aguas Claras",
      "Aguas claras",
      "Águas Claras",
    ],
  ],
  ["Água Quente", ["agual quente", "Água quente"]],
  [
    "Águas Lindas",
    [
      "Águas lindas",
      "Águas Lindas",
      "Águas lindas de Goiás",
      "ÁGUAS LINDAS DO GOIÁS",
    ],
  ],
  ["Arapoanga", ["Arapoanga", "Arapoangas", "Araponga"]],
  ["Arniqueira", ["Arniqueira", "Arniqueiras"]],
  [
    "Asa Norte",
    [
      "asa norte",
      "asa norte .",
      "Asa norte",
      "Asa norte - Brasilia / DF",
      "Asa Norte Brasília",
      "Brasília Asa Norte",
      "Asa Norte",
      "Asa Norte Brasília",
      "Brasília Asa Norte",
    ],
  ],
  ["Brasília", ["Brasilia", "Brasília"]],
  ["Brazlândia", ["Brazlandia", "Brazlândia", "Brazlândia DF"]],
  [
    "Ceilândia",
    [
      "Ceilandia",
      "Ceilândia",
      "Ceilândia Df",
      "Ceilandia    moro aqui no Setor P Sul o",
      "Ceilandia norte",
      "Ceilandia Norte",
      "Ceilândia Norte",
      "Ceilândia Norte - DF",
      "Ceilândia Norte- DF",
      "Ceilândia Norte- P Norte",
      "Ceilândia sol nascente",
      "Ceilandia sul",
      "Ceilandia Sul",
      "Ceilândia sul",
      "Ceilândia Sul",
      "Moro no Setor P Sul em Ceilandia",
    ],
  ],
  [
    "Cruzeiro",
    [
      "Cruzeiro",
      "Cruzeiro Novo",
      "Cruzeiro velho",
      "Cruzeiro Velho",
      "Cruzeiro Velho DF",
    ],
  ],
  [
    "Gama",
    [
      "Gama",
      "Gama.",
      "Gama df",
      "Gama DF",
      "Gama-DF",
      "Gama oeste",
      "Gama  (RA II)",
      "Novo Gama",
    ],
  ],
  [
    "Guará",
    [
      "Guara",
      "Guará",
      "Guara 1",
      "Guará 1",
      "Guará 2",
      "Guará  I",
      "Guará I",
      "GuaraII",
      "Guará II",
    ],
  ],
  ["Paranoá", ["Paranoa", "Paranoá", "Paranoá _DF", "Paranoá Parque"]],
  ["Planaltina", ["Planaltina", "Planaltina df", "Planaltina DF", "Planaltina-DF"]],
  [
    "Riacho Fundo I",
    [
      "Riacho fundo 1",
      "Riacho Fundo 1",
      "Riacho Fundo I",
      "Riacho fundo l",
    ],
  ],
  [
    "Riacho Fundo II",
    [
      "Riacho fundo 2",
      "Riacho Fundo 2",
      "Riacho fundo dois",
      "Riacho fundo ii",
      "Riacho fundo II",
      "Riacho Fundo II",
      "Riacho fundo ll",
    ],
  ],
  [
    "Samambaia",
    [
      "samambaia",
      "Samambaia",
      "Samambaia DF",
      "Samambaia norte",
      "Samambaia-norte",
      "Samambaia Norte",
      "Samambaia-Norte",
      "samambaia sul",
      "Samambaia sul",
      "Samambaia Sul",
      "Samambaia Sul, DF.",
    ],
  ],
  [
    "Santa Maria",
    [
      "Santa maria",
      "Santa Maria",
      "Santa Maria Df",
      "Santa Maria DF",
      "Santa Maria-DF",
      "Santa maria norte",
      "Santa Maria norte",
      "Santa Maria Norte",
      "Santa Maria sul",
      "Santa Maria Sul",
      "Santa maria sul df",
    ],
  ],
  [
    "São Sebastião",
    [
      "São Sebastião",
      "Sao Sebastião-DF",
      "São Sebastião Df",
      "São Sebastião DF",
    ],
  ],
  [
    "Sobradinho",
    ["Sobradinho", "Sobradinho!", "Sobradinho DF", "Sobradinho-DF"],
  ],
  ["Sobradinho II", ["Sobradinho 2", "Sobradinho II"]],
  [
    "Taguatinga",
    [
      "Taguatinga",
      "Taguatinga Centro",
      "Taguatinga DF",
      "Taguatinga-DF",
      "Taguatinga norte",
      "Taguatinga -Norte",
      "Taguatinga Norte",
      "Taguatinga sul",
      "Taguatinga Sul",
    ],
  ],
];

function montarMapa() {
  const mapa = new Map();
  const duplicados = [];

  for (const [canonico, variantes] of GRUPOS) {
    for (const v of variantes) {
      const k = chaveNormalizada(v);
      if (!k) continue;
      if (mapa.has(k) && mapa.get(k) !== canonico) {
        duplicados.push({ chave: k, antigo: mapa.get(k), novo: canonico, variante: v });
      }
      mapa.set(k, canonico);
    }
    const kCanon = chaveNormalizada(canonico);
    if (kCanon && !mapa.has(kCanon)) {
      mapa.set(kCanon, canonico);
    }
  }

  if (duplicados.length) {
    console.warn("Aviso: mesma chave normalizada em dois grupos (última regra prevalece):");
    duplicados.forEach((d) => console.warn(`  ${d.chave}: ${d.antigo} vs ${d.novo} (variante: ${d.variante})`));
  }

  return mapa;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const mapa = montarMapa();

  let atualizados = 0;
  let jaCanonico = 0;
  let semRegra = 0;

  try {
    const rows = await EnderecoModel.findAll({
      attributes: ["id", "bairro"],
      where: {
        bairro: {
          [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }],
        },
      },
      raw: true,
    });

    for (const row of rows) {
      const atual = row.bairro;
      const chave = chaveNormalizada(atual);
      const destino = mapa.get(chave);

      if (!destino) {
        semRegra += 1;
        continue;
      }

      if (destino === atual) {
        jaCanonico += 1;
        continue;
      }

      atualizados += 1;
      if (dryRun) {
        console.log(`[dry-run] id=${row.id}: "${atual}" -> "${destino}"`);
      } else {
        await EnderecoModel.update({ bairro: destino }, { where: { id: row.id } });
      }
    }

    console.log(
      dryRun
        ? `[dry-run] Atualizariam: ${atualizados}; já canônicos: ${jaCanonico}; sem regra no mapa: ${semRegra}.`
        : `Concluído. Atualizados: ${atualizados}; já canônicos: ${jaCanonico}; sem regra no mapa: ${semRegra}.`,
    );
  } finally {
    await sequelize.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
