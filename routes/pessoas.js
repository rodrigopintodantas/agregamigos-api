const crypto = require("crypto");
const express = require("express");
const { QueryTypes } = require("sequelize");
const { sequelize, PessoaModel, EnderecoModel, ConsentimentoLgpdModel, CandidatoModel } = require("../models");
const { authBearerCandidatoObrigatorio } = require("../auth/authorize");

const router = express.Router();
const TERMO_CONSENTIMENTO_ATUAL = {
  versao: "2026-05-06-v1",
  texto:
    "Autorizo o tratamento dos meus dados pessoais para fins de cadastro, contato e gestão do relacionamento, nos termos da LGPD.",
};

function limparNumeros(value) {
  return value != null ? String(value).replace(/\D/g, "") : "";
}

function normalizarTexto(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function obterCampo(rowMap, aliases) {
  for (const alias of aliases) {
    const key = normalizarTexto(alias);
    if (rowMap[key] != null && String(rowMap[key]).trim() !== "") {
      return rowMap[key];
    }
  }
  return null;
}

function obterCampoEmail(rowMap, rawRow) {
  // Coluna renomeada para "email" no CSV — prioridade explícita.
  const diretoMapa =
    rowMap.email ??
    rowMap["e mail"] ??
    obterCampo(rowMap, [
      "email",
      "Email",
      "E-mail",
      "Endereço de e-mail",
      "Endereco de e-mail",
      "Endereco de email",
      "Endereço de email",
    ]);
  if (diretoMapa != null && String(diretoMapa).trim() !== "") return diretoMapa;

  // Propriedades diretas no objeto (mesmo nome que veio no JSON, sem passar pelo mapa).
  if (rawRow && typeof rawRow === "object") {
    const candidatos = [rawRow.email, rawRow.Email, rawRow["E-mail"], rawRow["email"]];
    for (const c of candidatos) {
      if (c != null && String(c).trim() !== "") return c;
    }
  }

  const porAliasLegado = obterCampo(rowMap, [
    "Endereço de e-mail",
    "Endereco de e-mail",
    "Endereco de email",
    "Endereço de email",
    "E-mail",
    "Email",
  ]);
  if (porAliasLegado != null) return porAliasLegado;

  // Fallback: localizar coluna de e-mail pelo texto normalizado.
  // NUNCA usar apenas "includes('mail')" — isso casa com "instagram" (contém "mail").
  const keys = Object.keys(rowMap);
  const emailKey = keys.find((key) => {
    if (key.includes("instagram")) return false;
    if (key === "email") return true;
    if (key.includes("e mail") || key.includes("e-mail")) return true;
    if (key.includes("endereco") && (key.includes("mail") || key.includes("email"))) return true;
    if (/(^|\s)email($|\s)/.test(key)) return true;
    return false;
  });
  if (emailKey) return rowMap[emailKey];

  // Último recurso: algum valor da linha parece e-mail (desalinhamento de colunas).
  if (rawRow && typeof rawRow === "object") {
    for (const v of Object.values(rawRow)) {
      const s = String(v ?? "").trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
    }
  }

  return null;
}

function parseDateTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;

  const brMatch = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!brMatch) return null;

  const [, dia, mes, ano, hora = "00", minuto = "00", segundo = "00"] = brMatch;
  const parsed = new Date(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateOnly(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return raw;

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const [, dia, mes, ano] = brMatch;
    return `${ano}-${mes}-${dia}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashTermo(texto) {
  return crypto.createHash("sha256").update(texto, "utf8").digest("hex");
}

function slugCandidatoPublico(value) {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!s || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return null;
  return s;
}

async function candidatoPorSlugPublico(res, slugParam) {
  const slug = slugCandidatoPublico(slugParam);
  if (!slug) {
    res.status(400).json({ message: "Slug de candidato invalido." });
    return null;
  }
  const candidato = await CandidatoModel.findOne({
    where: { slug },
    attributes: ["id", "slug", "nome"],
  });
  if (!candidato) {
    res.status(404).json({ message: "Candidato nao encontrado." });
    return null;
  }
  return candidato;
}

router.post("/link-cadastro/:slugPublico", async (req, res, next) => {
  try {
    const candidato = await candidatoPorSlugPublico(res, req.params.slugPublico);
    if (!candidato) return;

    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const dataNascimento =
      req.body?.data_nascimento != null && String(req.body.data_nascimento).trim()
        ? String(req.body.data_nascimento).trim()
        : null;
    const email = req.body?.email != null ? String(req.body.email).trim().toLowerCase() : "";
    const whatsapp = req.body?.whatsapp != null ? String(req.body.whatsapp).trim() : "";
    const instagram = req.body?.instagram != null ? String(req.body.instagram).trim() : "";
    const indicacao = req.body?.indicacao != null ? String(req.body.indicacao).trim() : "";
    const endereco = req.body?.endereco ?? {};
    const consentimento = req.body?.consentimento ?? {};
    const aceito = consentimento?.aceito === true;
    const termoVersao =
      consentimento?.termo_versao != null ? String(consentimento.termo_versao).trim() : "";

    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe nome com pelo menos 3 caracteres." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "E-mail inválido." });
    }
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return res.status(400).json({ message: "Data de nascimento inválida." });
    }
    if (!aceito) {
      return res.status(400).json({ message: "É necessário concordar com o termo de consentimento." });
    }
    if (termoVersao !== TERMO_CONSENTIMENTO_ATUAL.versao) {
      return res.status(400).json({
        message: "Versão do termo de consentimento inválida. Atualize a página e tente novamente.",
      });
    }

    const cep = limparNumeros(endereco.cep || "").slice(0, 8);
    const uf = endereco.uf != null ? String(endereco.uf).trim().toUpperCase().slice(0, 2) : null;

    const created = await sequelize.transaction(async (transaction) => {
      const pessoa = await PessoaModel.create(
        {
          nome,
          dataNascimento,
          email: email || null,
          whatsapp: whatsapp || null,
          instagram: instagram || null,
          indicacao: indicacao || null,
          candidatoId: candidato.id,
        },
        { transaction },
      );

      await EnderecoModel.create(
        {
          PessoaModelId: pessoa.id,
          cep: cep || null,
          logradouro: endereco.logradouro ? String(endereco.logradouro).trim() : null,
          numero: endereco.numero ? String(endereco.numero).trim() : null,
          complemento: endereco.complemento ? String(endereco.complemento).trim() : null,
          bairro: endereco.bairro ? String(endereco.bairro).trim() : null,
          cidade: endereco.cidade ? String(endereco.cidade).trim() : null,
          uf,
          ibge: endereco.ibge ? String(endereco.ibge).trim() : null,
        },
        { transaction },
      );

      const forwarded = req.headers["x-forwarded-for"];
      const ipOrigem =
        (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || "").split(",")[0]).trim() ||
        req.ip ||
        null;
      const userAgent = req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 512) : null;

      await ConsentimentoLgpdModel.create(
        {
          pessoa_id: pessoa.id,
          termo_versao: TERMO_CONSENTIMENTO_ATUAL.versao,
          termo_hash: hashTermo(TERMO_CONSENTIMENTO_ATUAL.texto),
          aceito: true,
          aceito_em: new Date(),
          origem: "link-cadastro-publico",
          ip_origem: ipOrigem || null,
          user_agent: userAgent,
        },
        { transaction },
      );

      return pessoa;
    });

    return res.status(201).json({
      id: created.id,
      message: "Cadastro realizado com sucesso.",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    const pessoas = await PessoaModel.findAll({
      where: { candidatoId: req.auth.CandidatoId },
      include: [{ model: EnderecoModel, required: false }],
      order: [["nome", "ASC"]],
    });
    return res.json(
      pessoas.map((p) => ({
        id: p.id,
        nome: p.nome,
        data_nascimento: p.dataNascimento ?? null,
        email: p.email ?? null,
        whatsapp: p.whatsapp ?? null,
        erro_whatsapp: Boolean(p.erroWhatsapp),
        engajamento_whatsapp: String(p.engajamentoWhatsapp || "sem_resposta"),
        instagram: p.instagram ?? null,
        indicacao: p.indicacao ?? null,
        endereco: p.EnderecoModel
          ? {
              cep: p.EnderecoModel.cep ?? null,
              logradouro: p.EnderecoModel.logradouro ?? null,
              numero: p.EnderecoModel.numero ?? null,
              complemento: p.EnderecoModel.complemento ?? null,
              bairro: p.EnderecoModel.bairro ?? null,
              cidade: p.EnderecoModel.cidade ?? null,
              uf: p.EnderecoModel.uf ?? null,
              ibge: p.EnderecoModel.ibge ?? null,
            }
          : null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/estatisticas", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    const cid = req.auth.CandidatoId;
    const totalCadastros = await PessoaModel.count({ where: { candidatoId: cid } });
    const bairrosAgg = await sequelize.query(
      `
      SELECT TRIM(e.bairro) AS bairro, COUNT(*)::integer AS quantidade
      FROM endereco e
      INNER JOIN pessoa p ON p.id = e.pessoa_id
      WHERE p.candidato_id = :cid
        AND e.bairro IS NOT NULL AND TRIM(e.bairro) <> ''
      GROUP BY TRIM(e.bairro)
      ORDER BY quantidade DESC, TRIM(e.bairro) ASC
      `,
      { type: QueryTypes.SELECT, replacements: { cid } },
    );

    return res.json({
      total_cadastros: totalCadastros,
      bairros: bairrosAgg.map((row) => ({
        bairro: row.bairro,
        quantidade: Number(row.quantidade),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const dataNascimento =
      req.body?.data_nascimento != null && String(req.body.data_nascimento).trim()
        ? String(req.body.data_nascimento).trim()
        : null;
    const email = req.body?.email != null ? String(req.body.email).trim().toLowerCase() : "";
    const whatsapp = req.body?.whatsapp != null ? String(req.body.whatsapp).trim() : "";
    const instagram = req.body?.instagram != null ? String(req.body.instagram).trim() : "";
    const indicacao = req.body?.indicacao != null ? String(req.body.indicacao).trim() : "";
    const endereco = req.body?.endereco ?? {};

    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe nome com pelo menos 3 caracteres." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "E-mail inválido." });
    }
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return res.status(400).json({ message: "Data de nascimento inválida." });
    }

    const cep = limparNumeros(endereco.cep || "").slice(0, 8);
    const uf = endereco.uf != null ? String(endereco.uf).trim().toUpperCase().slice(0, 2) : null;

    const created = await sequelize.transaction(async (transaction) => {
      const pessoa = await PessoaModel.create(
        {
          nome,
          dataNascimento,
          email: email || null,
          whatsapp: whatsapp || null,
          instagram: instagram || null,
          indicacao: indicacao || null,
          candidatoId: req.auth.CandidatoId,
        },
        { transaction },
      );

      await EnderecoModel.create(
        {
          PessoaModelId: pessoa.id,
          cep: cep || null,
          logradouro: endereco.logradouro ? String(endereco.logradouro).trim() : null,
          numero: endereco.numero ? String(endereco.numero).trim() : null,
          complemento: endereco.complemento ? String(endereco.complemento).trim() : null,
          bairro: endereco.bairro ? String(endereco.bairro).trim() : null,
          cidade: endereco.cidade ? String(endereco.cidade).trim() : null,
          uf,
          ibge: endereco.ibge ? String(endereco.ibge).trim() : null,
        },
        { transaction },
      );

      return pessoa;
    });

    return res.status(201).json({ id: created.id, message: "Pessoa cadastrada com sucesso." });
  } catch (err) {
    next(err);
  }
});

router.post("/importar-csv", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    const registros = Array.isArray(req.body?.registros) ? req.body.registros : [];
    if (!registros.length) {
      return res.status(400).json({ message: "Arquivo CSV sem registros válidos." });
    }

    const payload = registros
      .map((item) => {
        const row = item && typeof item === "object" ? item : {};
        const rowMap = {};
        Object.entries(row).forEach(([key, value]) => {
          rowMap[normalizarTexto(key)] = value;
        });

        const nome = String(
          obterCampo(rowMap, ["Nome Completo:", "Nome Completo", "Nome", "nome_completo"]) ?? "",
        ).trim();
        if (nome.length < 3) return null;

        const email = String(obterCampoEmail(rowMap, row) ?? "")
          .trim()
          .toLowerCase();
        const whatsapp = limparNumeros(
          obterCampo(rowMap, ["Telefone com DDD (preferencialmente Whatsapp):", "Telefone com DDD", "Whatsapp"]) ?? "",
        ).slice(0, 20);
        const dataNascimento = parseDateOnly(
          obterCampo(rowMap, ["Data de Nascimento:", "Data de Nascimento"]),
        );
        const instagram =
          String(obterCampo(rowMap, ["Perfil do Instagram:", "Instagram", "Instragram"]) ?? "").trim() ||
          null;
        const indicacao =
          String(obterCampo(rowMap, ["Indicacao", "Indicação"]) ?? "").trim() || null;
        const logradouro =
          String(obterCampo(rowMap, ["Endereço:", "Endereco:", "Endereco", "Endereço", "Logradouro", "Logadouro"]) ?? "")
            .trim() || null;
        const bairro =
          String(obterCampo(rowMap, ["Região Administrativa:", "Regiao Administrativa:", "Região Administrativa", "Regiao Administrativa"]) ?? "").trim() ||
          null;
        const createdAt = parseDateTime(
          obterCampo(rowMap, ["Carimbo de data/hora", "Carimbo data/hora", "created_at"]),
        );

        return {
          nome,
          dataNascimento,
          email: email || null,
          whatsapp: whatsapp || null,
          instagram,
          indicacao,
          createdAt,
          endereco: {
            logradouro,
            bairro,
          },
        };
      })
      .filter(Boolean);

    if (!payload.length) {
      return res.status(400).json({ message: "Nenhum registro válido para importar." });
    }

    const pessoasExistentes = await PessoaModel.findAll({
      attributes: ["nome"],
      where: { candidatoId: req.auth.CandidatoId },
    });
    const nomesNormalizadosExistentes = new Set(
      pessoasExistentes
        .map((pessoa) => normalizarTexto(pessoa.nome))
        .filter((nome) => nome.length > 0),
    );

    const payloadSemDuplicados = [];
    let duplicadosIgnorados = 0;
    const nomesDuplicados = [];
    for (const item of payload) {
      const nomeNormalizado = normalizarTexto(item.nome);
      if (!nomeNormalizado || nomesNormalizadosExistentes.has(nomeNormalizado)) {
        duplicadosIgnorados += 1;
        nomesDuplicados.push(item.nome);
        continue;
      }

      nomesNormalizadosExistentes.add(nomeNormalizado);
      payloadSemDuplicados.push(item);
    }

    if (!payloadSemDuplicados.length) {
      return res.status(400).json({
        message: "Nenhum registro novo para importar. Todos os nomes já existem.",
      });
    }

    await sequelize.transaction(async (transaction) => {
      for (const item of payloadSemDuplicados) {
        const pessoa = await PessoaModel.create(
          {
            nome: item.nome,
            dataNascimento: item.dataNascimento,
            email: item.email,
            whatsapp: item.whatsapp,
            instagram: item.instagram,
            indicacao: item.indicacao,
            candidatoId: req.auth.CandidatoId,
            ...(item.createdAt ? { createdAt: item.createdAt, updatedAt: item.createdAt } : {}),
          },
          { transaction },
        );

        await EnderecoModel.create(
          {
            PessoaModelId: pessoa.id,
            logradouro: item.endereco.logradouro,
            bairro: item.endereco.bairro,
          },
          { transaction },
        );
      }
    });

    const sufixoIgnorados =
      duplicadosIgnorados > 0 ? ` ${duplicadosIgnorados} duplicado(s) ignorado(s).` : "";

    return res.status(201).json({
      message: `${payloadSemDuplicados.length} registro(s) importado(s) com sucesso.${sufixoIgnorados}`,
      total: payloadSemDuplicados.length,
      nomes_duplicados: nomesDuplicados,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID inválido." });
    }

    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const dataNascimento =
      req.body?.data_nascimento != null && String(req.body.data_nascimento).trim()
        ? String(req.body.data_nascimento).trim()
        : null;
    const email = req.body?.email != null ? String(req.body.email).trim().toLowerCase() : "";
    const whatsapp = req.body?.whatsapp != null ? String(req.body.whatsapp).trim() : "";
    const instagram = req.body?.instagram != null ? String(req.body.instagram).trim() : "";
    const indicacao = req.body?.indicacao != null ? String(req.body.indicacao).trim() : "";
    const endereco = req.body?.endereco ?? {};

    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe nome com pelo menos 3 caracteres." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "E-mail inválido." });
    }
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return res.status(400).json({ message: "Data de nascimento inválida." });
    }

    const cep = limparNumeros(endereco.cep || "").slice(0, 8);
    const uf = endereco.uf != null ? String(endereco.uf).trim().toUpperCase().slice(0, 2) : null;

    const updated = await sequelize.transaction(async (transaction) => {
      const pessoa = await PessoaModel.findOne({
        where: { id, candidatoId: req.auth.CandidatoId },
        transaction,
      });
      if (!pessoa) return null;

      await pessoa.update(
        {
          nome,
          dataNascimento,
          email: email || null,
          whatsapp: whatsapp || null,
          instagram: instagram || null,
          indicacao: indicacao || null,
        },
        { transaction },
      );

      const enderecoPayload = {
        cep: cep || null,
        logradouro: endereco.logradouro ? String(endereco.logradouro).trim() : null,
        numero: endereco.numero ? String(endereco.numero).trim() : null,
        complemento: endereco.complemento ? String(endereco.complemento).trim() : null,
        bairro: endereco.bairro ? String(endereco.bairro).trim() : null,
        cidade: endereco.cidade ? String(endereco.cidade).trim() : null,
        uf,
        ibge: endereco.ibge ? String(endereco.ibge).trim() : null,
      };

      const enderecoAtual = await EnderecoModel.findOne({
        where: { PessoaModelId: pessoa.id },
        transaction,
      });
      if (enderecoAtual) {
        await enderecoAtual.update(enderecoPayload, { transaction });
      } else {
        await EnderecoModel.create(
          {
            PessoaModelId: pessoa.id,
            ...enderecoPayload,
          },
          { transaction },
        );
      }

      return pessoa;
    });

    if (!updated) {
      return res.status(404).json({ message: "Pessoa não encontrada." });
    }

    return res.json({ message: "Pessoa atualizada com sucesso." });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID inválido." });
    }

    const deleted = await PessoaModel.destroy({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!deleted) {
      return res.status(404).json({ message: "Pessoa não encontrada." });
    }

    return res.json({ message: "Pessoa excluída com sucesso." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
