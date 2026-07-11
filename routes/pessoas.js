const crypto = require("crypto");
const express = require("express");
const { QueryTypes, Op } = require("sequelize");
const {
  sequelize,
  PessoaModel,
  EnderecoModel,
  ConsentimentoLgpdModel,
  CandidatoModel,
  UsuarioCandidatoModel,
  UsuarioModel,
  PapelModel,
  EventoModel,
  EventoPessoaModel,
} = require("../models");
const {
  listarCoordenadoresResumoPorEventoId,
  idsCoordenadoresDoEvento,
} = require("../services/evento-coordenador");
const {
  listarBairrosVinculados,
  wherePessoasListagemCoordenador,
  sqlFiltroCoordenadorPessoas,
} = require("../services/coordenador-bairro");
const { authBearerCandidatoObrigatorio } = require("../auth/authorize");

const router = express.Router();
const TERMO_CONSENTIMENTO_ATUAL = {
  versao: "2026-05-06-v1",
  texto:
    "Autorizo o tratamento dos meus dados pessoais para fins de cadastro, contato e gestão do relacionamento, nos termos da LGPD.",
};

function ehCoordenador(req) {
  return String(req.auth?.PapelNome ?? "") === "Coordenador";
}

function ehLoginAdminSistema(req) {
  return String(req.auth?.preferred_username ?? "").trim().toLowerCase() === "admin";
}

const ENGAJAMENTOS_WHATSAPP_VALIDOS = new Set(["sem_resposta", "positivo", "negativo", "neutro"]);

function normalizarEngajamentoWhatsapp(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return ENGAJAMENTOS_WHATSAPP_VALIDOS.has(v) ? v : null;
}

async function wherePessoasListagem(req) {
  const base = { candidatoId: req.auth.CandidatoId };
  if (ehCoordenador(req)) {
    return wherePessoasListagemCoordenador(req.auth.CandidatoId, req.auth.UsuarioId);
  }
  return base;
}

function limparNumeros(value) {
  return value != null ? String(value).replace(/\D/g, "") : "";
}

/** Dígitos comparáveis para evitar duplicar WhatsApp no mesmo candidato (CSV e base). */
function normalizarWhatsappComparacao(value) {
  let digits = limparNumeros(value);
  if (!digits) return "";

  digits = digits.replace(/^00+/, "").replace(/^0+/, "");

  const comOperadora = digits.match(/^0\d{2}(\d{10,11})$/);
  if (comOperadora?.[1]) {
    digits = comOperadora[1];
  }

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = `55${digits}`;
  }

  return digits.slice(0, 20);
}

async function buscarPessoaPorWhatsappDuplicado(candidatoId, whatsapp, excludePessoaId = null) {
  const whatsappNorm = normalizarWhatsappComparacao(whatsapp);
  if (!whatsappNorm) return null;

  const pessoas = await PessoaModel.findAll({
    attributes: ["id", "nome", "whatsapp"],
    where: { candidatoId },
  });

  for (const pessoa of pessoas) {
    if (excludePessoaId != null && Number(pessoa.id) === Number(excludePessoaId)) continue;
    if (normalizarWhatsappComparacao(pessoa.whatsapp) === whatsappNorm) {
      return pessoa;
    }
  }
  return null;
}

function mensagemWhatsappDuplicado(pessoaExistente) {
  const nome = pessoaExistente?.nome ? String(pessoaExistente.nome).trim() : "";
  if (nome) {
    return `Este WhatsApp já está cadastrado para ${nome}.`;
  }
  return "Este WhatsApp já está cadastrado.";
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

function obterCampoTelefone(rowMap, rawRow) {
  const direto = obterCampo(rowMap, [
    "Telefone com DDD (preferencialmente Whatsapp):",
    "Telefone com DDD (preferencialmente Whatsapp)",
    "Telefone com DDD",
    "Telefone com ddd",
    "Whatsapp",
    "WhatsApp",
    "Whats App",
    "Celular",
    "Telefone",
    "Telefone celular",
    "Numero de telefone",
    "Número de telefone",
    "Fone",
  ]);
  if (direto != null && String(direto).trim() !== "") return direto;

  if (rawRow && typeof rawRow === "object") {
    for (const [key, value] of Object.entries(rawRow)) {
      const norm = normalizarTexto(key);
      if (colunaPareceTelefone(norm) && value != null && String(value).trim() !== "") {
        return value;
      }
    }
  }

  const keys = Object.keys(rowMap);
  const telefoneKey = keys.find((key) => colunaPareceTelefone(key));
  if (telefoneKey) return rowMap[telefoneKey];

  return null;
}

function colunaPareceTelefone(keyNormalizado) {
  if (!keyNormalizado) return false;
  if (keyNormalizado.includes("instagram")) return false;
  if (keyNormalizado.includes("email") || keyNormalizado.includes("e mail")) return false;
  if (keyNormalizado.includes("endereco") && keyNormalizado.includes("mail")) return false;
  if (keyNormalizado.includes("telefone") || keyNormalizado.includes("whatsapp")) return true;
  if (keyNormalizado.includes("celular") || keyNormalizado === "fone") return true;
  if (keyNormalizado.includes("fone") && !keyNormalizado.includes("microfone")) return true;
  return false;
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
    attributes: ["id", "slug", "nome", "imagemOg"],
  });
  if (!candidato) {
    res.status(404).json({ message: "Candidato nao encontrado." });
    return null;
  }
  return candidato;
}

/** Nomes de query reservados; demais chaves "flag" alfanuméricas são tratadas como token de divulgação. */
const QUERY_PARAMS_RESERVADOS_LINK_CADASTRO = new Set(["coordenador", "evento"]);

async function buscarEventoAtivoPorToken(candidatoId, token) {
  const t = String(token ?? "").trim();
  if (!t) return null;
  return EventoModel.findOne({
    where: {
      candidatoId,
      token_cadastro: t,
      status: { [Op.ne]: "encerrado" },
    },
  });
}

async function vincularPessoaAoEvento(eventoId, pessoaId, transaction) {
  const [vinculo, created] = await EventoPessoaModel.findOrCreate({
    where: { evento_id: eventoId, pessoa_id: pessoaId },
    defaults: { evento_id: eventoId, pessoa_id: pessoaId },
    transaction,
  });
  if (created) {
    await EventoModel.increment("total_inscritos", {
      by: 1,
      where: { id: eventoId },
      transaction,
    });
  }
  return vinculo;
}

function chavesDivulgacaoLinkCadastroNaQuery(req) {
  const q = req.query || {};
  const found = [];
  for (const k of Object.keys(q)) {
    if (!k || QUERY_PARAMS_RESERVADOS_LINK_CADASTRO.has(k)) continue;
    const raw = q[k];
    const valStr =
      raw === undefined || raw === null ? "" : Array.isArray(raw) ? String(raw[0] ?? "").trim() : String(raw).trim();
    if (valStr !== "") continue;
    if (!/^[A-Za-z0-9]{10,32}$/.test(k)) continue;
    found.push(k);
  }
  return found;
}

router.get("/link-cadastro/:slugPublico/contexto", async (req, res, next) => {
  try {
    const candidato = await candidatoPorSlugPublico(res, req.params.slugPublico);
    if (!candidato) return;

    const vinculos = await UsuarioCandidatoModel.findAll({
      where: { candidato_id: candidato.id },
      include: [
        {
          model: UsuarioModel,
          required: true,
          attributes: ["id", "nome"],
          include: [
            {
              model: PapelModel,
              required: true,
              attributes: [],
              where: { nome: "Coordenador" },
            },
          ],
        },
      ],
    });

    const coordenadores = vinculos
      .map((v) => v.UsuarioModel)
      .filter(Boolean)
      .map((u) => ({ id: u.id, nome: u.nome }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt"));

    const chavesDivulgacao = chavesDivulgacaoLinkCadastroNaQuery(req);
    if (chavesDivulgacao.length > 1) {
      return res.status(400).json({ message: "Link de cadastro invalido." });
    }

    const tokenEventoQuery = String(req.query?.evento ?? "").trim();
    let eventoContexto = null;
    if (tokenEventoQuery) {
      const eventoRow = await buscarEventoAtivoPorToken(candidato.id, tokenEventoQuery);
      if (!eventoRow) {
        return res.status(400).json({ message: "Link de evento invalido ou evento encerrado." });
      }
      eventoContexto = {
        id: eventoRow.id,
        nome: eventoRow.nome,
        token_cadastro: eventoRow.token_cadastro,
      };
    }

    let preselected_coordenador_id = null;
    if (chavesDivulgacao.length === 1) {
      const tokenChave = chavesDivulgacao[0];
      const vinculoToken = await UsuarioCandidatoModel.findOne({
        where: {
          candidato_id: candidato.id,
          token_divulgacao_cadastro: tokenChave,
        },
        include: [
          {
            model: UsuarioModel,
            required: true,
            attributes: ["id"],
            include: [
              {
                model: PapelModel,
                required: true,
                attributes: [],
                where: { nome: "Coordenador" },
              },
            ],
          },
        ],
      });
      if (!vinculoToken) {
        return res.status(400).json({ message: "Link de cadastro invalido." });
      }
      preselected_coordenador_id = vinculoToken.usuario_id;
    }

    let coordenadoresLink = coordenadores;
    if (eventoContexto) {
      const coordsEvento = await listarCoordenadoresResumoPorEventoId(eventoContexto.id);
      if (coordsEvento.length) {
        coordenadoresLink = [...coordsEvento];
        if (preselected_coordenador_id != null) {
          const jaNaLista = coordenadoresLink.some((c) => c.id === preselected_coordenador_id);
          if (!jaNaLista) {
            const coordPre = coordenadores.find((c) => c.id === preselected_coordenador_id);
            if (coordPre) coordenadoresLink.push(coordPre);
          }
        } else if (coordsEvento.length === 1) {
          preselected_coordenador_id = coordsEvento[0].id;
        }
      }
    }

    return res.json({
      candidato: {
        nome: candidato.nome,
        slug: candidato.slug,
        imagem_og: candidato.imagemOg ?? null,
      },
      coordenadores: coordenadoresLink,
      preselected_coordenador_id,
      evento: eventoContexto,
    });
  } catch (err) {
    next(err);
  }
});

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

    const idCoordenadorRaw = req.body?.id_coordenador;
    let idCoordenador =
      idCoordenadorRaw != null && idCoordenadorRaw !== ""
        ? Number(idCoordenadorRaw)
        : null;

    const tokenEventoBody = String(req.body?.token_evento ?? "").trim();
    let eventoCadastro = null;
    if (tokenEventoBody) {
      eventoCadastro = await buscarEventoAtivoPorToken(candidato.id, tokenEventoBody);
      if (!eventoCadastro) {
        return res.status(400).json({ message: "Evento invalido ou encerrado para este cadastro." });
      }
      const idsCoordsEvento = await idsCoordenadoresDoEvento(eventoCadastro.id);
      if (idsCoordsEvento.length && idCoordenador != null && !idsCoordsEvento.includes(idCoordenador)) {
        const coordValido = await UsuarioCandidatoModel.findOne({
          where: { candidato_id: candidato.id, usuario_id: idCoordenador },
          include: [
            {
              model: UsuarioModel,
              required: true,
              attributes: ["id"],
              include: [
                {
                  model: PapelModel,
                  required: true,
                  attributes: [],
                  where: { nome: "Coordenador" },
                },
              ],
            },
          ],
        });
        if (!coordValido) {
          return res.status(400).json({
            message: "Coordenador invalido para este evento. Selecione um dos coordenadores do evento.",
          });
        }
      }
    }

    if (idCoordenador != null) {
      if (!Number.isInteger(idCoordenador) || idCoordenador <= 0) {
        return res.status(400).json({ message: "Coordenador invalido." });
      }
      const vinculoCoord = await UsuarioCandidatoModel.findOne({
        where: { candidato_id: candidato.id, usuario_id: idCoordenador },
        include: [
          {
            model: UsuarioModel,
            required: true,
            attributes: ["id"],
            include: [
              {
                model: PapelModel,
                required: true,
                attributes: ["nome"],
                where: { nome: "Coordenador" },
              },
            ],
          },
        ],
      });
      if (!vinculoCoord) {
        return res.status(400).json({ message: "Coordenador invalido para este candidato." });
      }
    }

    const cep = limparNumeros(endereco.cep || "").slice(0, 8);
    const uf = endereco.uf != null ? String(endereco.uf).trim().toUpperCase().slice(0, 2) : null;

    const duplicataWhatsapp = await buscarPessoaPorWhatsappDuplicado(candidato.id, whatsapp);
    if (duplicataWhatsapp) {
      return res.status(409).json({ message: mensagemWhatsappDuplicado(duplicataWhatsapp) });
    }

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
          idCoordenador,
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
          origem: eventoCadastro ? "link-cadastro-evento" : "link-cadastro-publico",
          ip_origem: ipOrigem || null,
          user_agent: userAgent,
        },
        { transaction },
      );

      if (eventoCadastro) {
        await vincularPessoaAoEvento(eventoCadastro.id, pessoa.id, transaction);
      }

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
      where: await wherePessoasListagem(req),
      include: [
        { model: EnderecoModel, required: false },
        { model: CandidatoModel, attributes: ["nome", "slug"], required: true },
      ],
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
        candidato_nome: p.CandidatoModel?.nome ?? null,
        candidato_slug: p.CandidatoModel?.slug ?? null,
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
    const coord = ehCoordenador(req);
    const uid = req.auth.UsuarioId;
    let filtroCoord = "";
    const replacements = { cid };

    if (coord) {
      const bairros = await listarBairrosVinculados(cid, uid);
      const filtro = sqlFiltroCoordenadorPessoas(uid, bairros);
      filtroCoord = filtro.sql;
      Object.assign(replacements, filtro.replacements);
    }

    const totalCadastros = coord
      ? await PessoaModel.count({
          where: { candidatoId: cid, idCoordenador: uid },
        })
      : await PessoaModel.count({
          where: { candidatoId: cid },
        });

    const totalCadastrosResponsavel = coord
      ? await PessoaModel.count({
          where: await wherePessoasListagem(req),
        })
      : null;

    const bairrosAgg = await sequelize.query(
      `
      SELECT TRIM(e.bairro) AS bairro, COUNT(*)::integer AS quantidade
      FROM endereco e
      INNER JOIN pessoa p ON p.id = e.pessoa_id
      WHERE p.candidato_id = :cid
        ${filtroCoord}
        AND e.bairro IS NOT NULL AND TRIM(e.bairro) <> ''
      GROUP BY TRIM(e.bairro)
      ORDER BY quantidade DESC, TRIM(e.bairro) ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements,
      },
    );

    return res.json({
      total_cadastros: totalCadastros,
      total_cadastros_responsavel: totalCadastrosResponsavel,
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
    if (ehCoordenador(req)) {
      return res.status(403).json({ message: "Operação reservada ao administrador." });
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

    const duplicataWhatsapp = await buscarPessoaPorWhatsappDuplicado(req.auth.CandidatoId, whatsapp);
    if (duplicataWhatsapp) {
      return res.status(409).json({ message: mensagemWhatsappDuplicado(duplicataWhatsapp) });
    }

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

    const eventoIdRaw = req.body?.evento_id;
    let eventoImportacao = null;
    if (eventoIdRaw != null && eventoIdRaw !== "") {
      const eventoId = Number(eventoIdRaw);
      if (!Number.isInteger(eventoId) || eventoId <= 0) {
        return res.status(400).json({ message: "Evento invalido." });
      }
      eventoImportacao = await EventoModel.findOne({
        where: { id: eventoId, candidatoId: req.auth.CandidatoId },
      });
      if (!eventoImportacao) {
        return res.status(404).json({ message: "Evento nao encontrado." });
      }
    }

    if (ehCoordenador(req) && !eventoImportacao) {
      return res.status(403).json({ message: "Operação reservada ao administrador." });
    }

    const idCoordenadorImportacao =
      ehCoordenador(req) && eventoImportacao ? Number(req.auth.UsuarioId) : null;
    const coordenadorImportacaoValido =
      idCoordenadorImportacao != null &&
      Number.isInteger(idCoordenadorImportacao) &&
      idCoordenadorImportacao > 0;

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
        const whatsapp = limparNumeros(obterCampoTelefone(rowMap, row) ?? "").slice(0, 20);
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
      attributes: ["id", "nome", "whatsapp"],
      where: { candidatoId: req.auth.CandidatoId },
    });

    const nomesNormalizadosExistentes = new Set();
    /** @type {Map<string, string>} whatsapp normalizado → nome já cadastrado */
    const whatsappsNormalizadosExistentes = new Map();
    /** @type {Map<string, number>} nome normalizado → id pessoa */
    const idsPorNomeNormalizado = new Map();
    /** @type {Map<string, number>} whatsapp normalizado → id pessoa */
    const idsPorWhatsappNormalizado = new Map();

    for (const pessoa of pessoasExistentes) {
      const nomeNorm = normalizarTexto(pessoa.nome);
      if (nomeNorm) {
        nomesNormalizadosExistentes.add(nomeNorm);
        if (!idsPorNomeNormalizado.has(nomeNorm)) {
          idsPorNomeNormalizado.set(nomeNorm, pessoa.id);
        }
      }

      const whatsappNorm = normalizarWhatsappComparacao(pessoa.whatsapp);
      if (whatsappNorm && !whatsappsNormalizadosExistentes.has(whatsappNorm)) {
        whatsappsNormalizadosExistentes.set(whatsappNorm, String(pessoa.nome || "").trim());
        idsPorWhatsappNormalizado.set(whatsappNorm, pessoa.id);
      }
    }

    const payloadSemDuplicados = [];
    let duplicadosIgnorados = 0;
    const nomesDuplicados = [];
    const registrosNaoImportados = [];
    const idsVincularEvento = new Set();

    for (const item of payload) {
      const nomeNormalizado = normalizarTexto(item.nome);
      if (!nomeNormalizado || nomesNormalizadosExistentes.has(nomeNormalizado)) {
        duplicadosIgnorados += 1;
        nomesDuplicados.push(item.nome);
        registrosNaoImportados.push({
          nome: item.nome,
          whatsapp: item.whatsapp || null,
          motivo: "nome_duplicado",
          cadastro_existente: null,
        });
        if (eventoImportacao && nomeNormalizado) {
          const pid = idsPorNomeNormalizado.get(nomeNormalizado);
          if (pid) idsVincularEvento.add(pid);
        }
        continue;
      }

      const whatsappNorm = normalizarWhatsappComparacao(item.whatsapp);
      if (whatsappNorm && whatsappsNormalizadosExistentes.has(whatsappNorm)) {
        duplicadosIgnorados += 1;
        registrosNaoImportados.push({
          nome: item.nome,
          whatsapp: item.whatsapp || null,
          motivo: "whatsapp_duplicado",
          cadastro_existente: whatsappsNormalizadosExistentes.get(whatsappNorm) || null,
        });
        if (eventoImportacao) {
          const pid = idsPorWhatsappNormalizado.get(whatsappNorm);
          if (pid) idsVincularEvento.add(pid);
        }
        continue;
      }

      nomesNormalizadosExistentes.add(nomeNormalizado);
      if (whatsappNorm) {
        whatsappsNormalizadosExistentes.set(whatsappNorm, item.nome);
      }
      payloadSemDuplicados.push(item);
    }

    if (!payloadSemDuplicados.length && (!eventoImportacao || !idsVincularEvento.size)) {
      return res.status(400).json({
        message:
          "Nenhum registro novo para importar. Todos os registros já existem (nome ou WhatsApp repetido).",
        registros_nao_importados: registrosNaoImportados,
        nomes_duplicados: nomesDuplicados,
      });
    }

    const idsImportados = [];
    let vinculadosEvento = 0;
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
            ...(coordenadorImportacaoValido ? { idCoordenador: idCoordenadorImportacao } : {}),
            ...(item.createdAt ? { createdAt: item.createdAt, updatedAt: item.createdAt } : {}),
          },
          { transaction },
        );
        idsImportados.push(pessoa.id);
        if (eventoImportacao) {
          idsVincularEvento.add(pessoa.id);
        }

        await EnderecoModel.create(
          {
            PessoaModelId: pessoa.id,
            logradouro: item.endereco.logradouro,
            bairro: item.endereco.bairro,
          },
          { transaction },
        );
      }

      if (coordenadorImportacaoValido && idsVincularEvento.size) {
        await PessoaModel.update(
          { idCoordenador: idCoordenadorImportacao },
          {
            where: {
              id: [...idsVincularEvento],
              candidatoId: req.auth.CandidatoId,
            },
            transaction,
          },
        );
      }

      if (eventoImportacao) {
        for (const pessoaId of idsVincularEvento) {
          const antes = await EventoPessoaModel.findOne({
            where: { evento_id: eventoImportacao.id, pessoa_id: pessoaId },
            transaction,
          });
          await vincularPessoaAoEvento(eventoImportacao.id, pessoaId, transaction);
          if (!antes) vinculadosEvento += 1;
        }
      }
    });

    const semWhatsapp = payloadSemDuplicados.filter((item) => !item.whatsapp).length;
    const sufixoIgnorados =
      duplicadosIgnorados > 0 ? ` ${duplicadosIgnorados} duplicado(s) ignorado(s).` : "";
    const sufixoSemTelefone =
      semWhatsapp > 0
        ? ` Atenção: ${semWhatsapp} registro(s) ficaram sem telefone (coluna não encontrada ou vazia no CSV).`
        : "";
    const sufixoEvento =
      eventoImportacao && vinculadosEvento > 0
        ? ` ${vinculadosEvento} contato(s) vinculado(s) ao evento.`
        : "";

    const totalImportados = payloadSemDuplicados.length;
    const mensagemBase =
      totalImportados > 0
        ? `${totalImportados} registro(s) importado(s) com sucesso.`
        : vinculadosEvento > 0
          ? `${vinculadosEvento} contato(s) existente(s) vinculado(s) ao evento.`
          : "Importação concluída.";

    return res.status(201).json({
      message: `${mensagemBase}${sufixoIgnorados}${sufixoSemTelefone}${sufixoEvento}`,
      total: totalImportados,
      nomes_duplicados: nomesDuplicados,
      registros_nao_importados: registrosNaoImportados,
      ids_importados: idsImportados,
      sem_whatsapp: semWhatsapp,
      vinculados_evento: vinculadosEvento,
    });
  } catch (err) {
    next(err);
  }
});

function minutosDesfazerRecentes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 120;
  return Math.min(Math.max(Math.round(n), 5), 24 * 60);
}

router.get("/importar-csv/desfazer-recentes/preview", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    if (!ehLoginAdminSistema(req)) {
      return res.status(403).json({ message: "Apenas o usuário com login admin pode desfazer importações." });
    }
    if (ehCoordenador(req)) {
      return res.status(403).json({ message: "Operação reservada ao administrador." });
    }

    const minutos = minutosDesfazerRecentes(req.query?.minutos);
    const desde = new Date(Date.now() - minutos * 60 * 1000);
    const pessoas = await PessoaModel.findAll({
      attributes: ["id", "nome", "createdAt"],
      where: {
        candidatoId: req.auth.CandidatoId,
        createdAt: { [Op.gte]: desde },
      },
      order: [["createdAt", "DESC"]],
      limit: 5000,
    });

    return res.json({
      minutos,
      total: pessoas.length,
      nomes_amostra: pessoas.slice(0, 15).map((p) => String(p.nome || "").trim()),
      ids: pessoas.map((p) => p.id),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/importar-csv/desfazer-recentes", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    if (!ehLoginAdminSistema(req)) {
      return res.status(403).json({ message: "Apenas o usuário com login admin pode desfazer importações." });
    }
    if (ehCoordenador(req)) {
      return res.status(403).json({ message: "Operação reservada ao administrador." });
    }

    const minutos = minutosDesfazerRecentes(req.body?.minutos);
    const desde = new Date(Date.now() - minutos * 60 * 1000);
    const pessoas = await PessoaModel.findAll({
      attributes: ["id"],
      where: {
        candidatoId: req.auth.CandidatoId,
        createdAt: { [Op.gte]: desde },
      },
      limit: 5000,
    });
    const idsValidos = pessoas.map((p) => p.id);

    if (!idsValidos.length) {
      return res.status(404).json({
        message: `Nenhum cadastro criado nos últimos ${minutos} minuto(s) para desfazer.`,
      });
    }

    const removidos = await sequelize.transaction(async (transaction) => {
      return PessoaModel.destroy({
        where: { id: idsValidos, candidatoId: req.auth.CandidatoId },
        transaction,
      });
    });

    return res.json({
      message: `${removidos} cadastro(s) criado(s) nos últimos ${minutos} minuto(s) foram removido(s).`,
      removidos,
      ids_removidos: idsValidos,
      minutos,
    });
  } catch (err) {
    if (err?.name === "SequelizeForeignKeyConstraintError") {
      return res.status(409).json({
        message:
          "Não foi possível desfazer: algum cadastro já está vinculado a campanha ou outro registro.",
      });
    }
    next(err);
  }
});

router.post("/importar-csv/desfazer", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    if (!ehLoginAdminSistema(req)) {
      return res.status(403).json({ message: "Apenas o usuário com login admin pode desfazer importações." });
    }
    if (ehCoordenador(req)) {
      return res.status(403).json({ message: "Operação reservada ao administrador." });
    }

    const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(idsRaw.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length) {
      return res.status(400).json({ message: "Informe os IDs da importação a desfazer." });
    }

    const pessoas = await PessoaModel.findAll({
      attributes: ["id"],
      where: { id: ids, candidatoId: req.auth.CandidatoId },
    });
    const idsValidos = pessoas.map((p) => p.id);
    const idsIgnorados = ids.filter((id) => !idsValidos.includes(id));

    if (!idsValidos.length) {
      return res.status(404).json({
        message: "Nenhum registro desta importação foi encontrado para desfazer.",
      });
    }

    const removidos = await sequelize.transaction(async (transaction) => {
      return PessoaModel.destroy({
        where: { id: idsValidos, candidatoId: req.auth.CandidatoId },
        transaction,
      });
    });

    const sufixoIgnorados =
      idsIgnorados.length > 0 ? ` ${idsIgnorados.length} ID(s) ignorado(s) (não pertencem a este candidato).` : "";

    return res.json({
      message: `${removidos} registro(s) removido(s). Você pode importar o CSV novamente.${sufixoIgnorados}`,
      removidos,
      ids_removidos: idsValidos,
    });
  } catch (err) {
    if (err?.name === "SequelizeForeignKeyConstraintError") {
      return res.status(409).json({
        message:
          "Não foi possível desfazer: algum cadastro já está vinculado a campanha ou outro registro. Exclua manualmente o que for necessário.",
      });
    }
    next(err);
  }
});

router.put("/:id", authBearerCandidatoObrigatorio(), async (req, res, next) => {
  try {
    if (ehCoordenador(req)) {
      return res.status(403).json({ message: "Operação reservada ao administrador." });
    }
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
    const engajamentoNorm = normalizarEngajamentoWhatsapp(req.body?.engajamento_whatsapp);

    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe nome com pelo menos 3 caracteres." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "E-mail inválido." });
    }
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return res.status(400).json({ message: "Data de nascimento inválida." });
    }
    if (req.body?.engajamento_whatsapp != null && String(req.body.engajamento_whatsapp).trim() && !engajamentoNorm) {
      return res.status(400).json({
        message: "Engajamento inválido. Use: sem_resposta, positivo, negativo ou neutro.",
      });
    }

    const cep = limparNumeros(endereco.cep || "").slice(0, 8);
    const uf = endereco.uf != null ? String(endereco.uf).trim().toUpperCase().slice(0, 2) : null;

    const duplicataWhatsapp = await buscarPessoaPorWhatsappDuplicado(
      req.auth.CandidatoId,
      whatsapp,
      id,
    );
    if (duplicataWhatsapp) {
      return res.status(409).json({ message: mensagemWhatsappDuplicado(duplicataWhatsapp) });
    }

    const updated = await sequelize.transaction(async (transaction) => {
      const pessoa = await PessoaModel.findOne({
        where: { id, candidatoId: req.auth.CandidatoId },
        transaction,
      });
      if (!pessoa) return null;

      const updatePayload = {
        nome,
        dataNascimento,
        email: email || null,
        whatsapp: whatsapp || null,
        instagram: instagram || null,
        indicacao: indicacao || null,
      };
      if (engajamentoNorm) {
        updatePayload.engajamentoWhatsapp = engajamentoNorm;
      }

      await pessoa.update(updatePayload, { transaction });

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
    if (ehCoordenador(req)) {
      return res.status(403).json({ message: "Operação reservada ao administrador." });
    }
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
