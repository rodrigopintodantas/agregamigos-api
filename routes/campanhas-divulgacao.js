const express = require("express");
const { QueryTypes, Op } = require("sequelize");
const {
  sequelize,
  CampanhaDivulgacaoModel,
  CampanhaDestinatarioModel,
  PessoaModel,
  EnderecoModel,
  UsuarioModel,
  ModeloMensagemModel,
  WhatsappCanalModel,
} = require("../models");
const { authorize, authBearerCandidatoObrigatorio } = require("../auth/authorize");
const whatsappService = require("../services/whatsapp-baileys");
const {
  enfileirarDestinatarios,
  validarFilaDisponivel,
  removerJobsPendentesDaCampanha,
  removerTodosJobsDaCampanha,
} = require("../queues/campanha-envio-queue");
const {
  mesmoDiaEmFusoCampanha,
  adicionarDiasEmFusoCampanha,
  turnoPorHoraEmFusoCampanha,
  baseTurnoEmFusoCampanha,
} = require("../services/campanha-agendamento-fuso");
const {
  engajamentoDasSentimentosRespondidos,
  sqlExprSentimentoConsolidadoDestinatario,
  textosRespostaParaEngajamentoPainel,
  normalizarEngajamentoManual,
  aplicarEngajamentoManualDestinatario,
} = require("../services/pessoa-engajamento-whatsapp");

const router = express.Router();
const apenasAdmin = [authBearerCandidatoObrigatorio(), authorize(["Administrador"])];

function limparNumeros(value) {
  return value != null ? String(value).replace(/\D/g, "") : "";
}

function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const TURNOS = ["manha", "tarde", "noite"];

function indiceTurno(turno) {
  return Math.max(0, TURNOS.indexOf(turno));
}

function janelaTurno(turno) {
  if (turno === "manha") return { min: 0, max: 239 }; // 08:00-11:59
  if (turno === "tarde") return { min: 0, max: 239 }; // 13:00-16:59
  return { min: 0, max: 149 }; // 18:00-20:29
}

function gerarAgendamentoPorDisparo(index, mensagensPorTurno, disparoEm, usedKeys) {
  const baseInicial = new Date(disparoEm);
  const primeiroEnvio = new Date(baseInicial.getTime() + 60 * 1000);

  if (index === 0) {
    usedKeys.add(primeiroEnvio.toISOString());
    return {
      turno: turnoPorHoraEmFusoCampanha(primeiroEnvio),
      agendadoPara: primeiroEnvio,
    };
  }

  const porTurno = Math.max(1, mensagensPorTurno);
  const turnoInicial = turnoPorHoraEmFusoCampanha(primeiroEnvio);
  const bloco = Math.floor(index / porTurno);
  const turno = TURNOS[(indiceTurno(turnoInicial) + bloco) % TURNOS.length];
  const ciclosCompletos = Math.floor((indiceTurno(turnoInicial) + bloco) / TURNOS.length);
  const faixa = janelaTurno(turno);

  let offsetDia = ciclosCompletos;
  let candidate = null;
  while (!candidate) {
    const diaAlvo = adicionarDiasEmFusoCampanha(primeiroEnvio, offsetDia);
    const base = baseTurnoEmFusoCampanha(diaAlvo, turno);

    let minFaixa = faixa.min;
    if (mesmoDiaEmFusoCampanha(base, primeiroEnvio)) {
      const minutosDecorridos = Math.floor((primeiroEnvio.getTime() - base.getTime()) / 60000);
      minFaixa = Math.max(minFaixa, minutosDecorridos);
    }
    if (minFaixa > faixa.max) {
      offsetDia += 1;
      continue;
    }

    const minutos = randomIntInclusive(minFaixa, faixa.max);
    candidate = new Date(base.getTime() + minutos * 60 * 1000);
    if (candidate <= primeiroEnvio) {
      candidate = null;
      offsetDia += 1;
    }
  }

  let key = candidate.toISOString();
  while (usedKeys.has(key)) {
    candidate = new Date(candidate.getTime() + 60 * 1000);
    if (candidate <= primeiroEnvio) {
      candidate = new Date(primeiroEnvio.getTime() + 1);
    }
    key = candidate.toISOString();
  }
  usedKeys.add(key);

  return { turno, agendadoPara: candidate };
}

function campanhaEhAniversariantes(nome) {
  return /^aniversariantes do dia\s+\d{2}\/\d{2}(?:\s+\d{2}\/\d{2}_Parte_\d+)?$/i.test(
    String(nome ?? "").trim(),
  );
}

/** Máximo de destinatários por campanha ao criar; acima disso, particiona automaticamente. */
const MAX_PESSOAS_POR_CAMPANHA = 60;

const MAX_MENSAGENS_POR_TURNO = 50;

/** Status em que o agendamento ainda não foi gerado e o ritmo pode ser ajustado. */
const STATUS_EDITAVEIS_ANTES_DO_ENVIO = ["montada", "cancelada"];

function labelDataCriacaoSP(agora = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(agora);
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${day}/${month}`;
}

function nomeCampanhaComParte(nomeBase, parteNumero, dataLabel) {
  return `${String(nomeBase).trim()} ${dataLabel}_Parte_${parteNumero}`;
}

function particionarLista(lista, tamanho) {
  const chunks = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    chunks.push(lista.slice(i, i + tamanho));
  }
  return chunks;
}

const CAMPOS_RESET_REENVIO_DESTINATARIO = {
  status: "pendente",
  erro_ultimo: null,
  falha_entrega: false,
  falha_codigo: null,
  falha_em: null,
  wa_message_id_envio: null,
  enviado_em: null,
  agendado_para: null,
  resposta_1_texto: null,
  resposta_1_em: null,
  resposta_1_wa_id: null,
  resposta_1_sentimento: null,
  resposta_2_texto: null,
  resposta_2_em: null,
  resposta_2_wa_id: null,
  resposta_2_sentimento: null,
};

function resolverDisparoInicio(body) {
  const modo = String(body?.modo ?? "agora").trim().toLowerCase();
  let disparoEm = new Date();
  if (modo === "agendar") {
    const parsed = body?.agendado_para ? new Date(body.agendado_para) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return { error: "Informe data e hora validas para agendar o envio." };
    }
    const minimoMs = Date.now() + 60 * 1000;
    if (parsed.getTime() < minimoMs) {
      return { error: "O agendamento deve ser pelo menos 1 minuto no futuro." };
    }
    disparoEm = parsed;
  } else if (modo !== "agora") {
    return { error: "Modo invalido. Use: agora ou agendar." };
  }
  return { modo, disparoEm };
}

async function validarCanalWhatsappCampanha(campanha, candidatoId, acaoLabel) {
  const canalId = Number(campanha.whatsapp_canal_id);
  if (!Number.isInteger(canalId) || canalId <= 0) {
    return {
      error: "Campanha sem canal WhatsApp definido. Recrie a campanha selecionando um celular.",
    };
  }
  const canalRow = await WhatsappCanalModel.findOne({
    where: { id: canalId, candidatoId },
  });
  if (!canalRow) {
    return { error: "Canal WhatsApp da campanha nao encontrado." };
  }
  const wpp = whatsappService.getStatusByCanalId(canalId, candidatoId, canalRow.nome);
  if (!wpp.conectado) {
    return {
      error: `O celular "${canalRow.nome}" nao esta conectado. Conecte-o em Conexao WhatsApp antes de ${acaoLabel}.`,
    };
  }
  return { canalRow };
}

/** Impede iniciar/reiniciar se já houver outra campanha em andamento no mesmo celular. */
async function campanhaEmAndamentoNoMesmoCanal(candidatoId, canalId, excluirCampanhaId) {
  const idCanal = Number(canalId);
  if (!Number.isInteger(idCanal) || idCanal <= 0) return null;
  const where = {
    candidatoId,
    whatsapp_canal_id: idCanal,
    status: "em_andamento",
  };
  if (excluirCampanhaId != null) {
    where.id = { [Op.ne]: Number(excluirCampanhaId) };
  }
  return CampanhaDivulgacaoModel.findOne({
    where,
    attributes: ["id", "nome", "whatsapp_canal_id"],
  });
}

function mensagemConflitoCanalEmAndamento(conflito, canalNome) {
  const nomeCampanha = conflito?.nome ? `"${conflito.nome}"` : "outra campanha";
  const labelCanal = canalNome ? ` "${canalNome}"` : "";
  return `Ja existe a campanha ${nomeCampanha} em andamento no celular${labelCanal}. Aguarde a finalizacao ou cancele-a antes de iniciar outra no mesmo celular.`;
}

async function resetarDestinatariosCanceladosEErros(campanhaId) {
  const [total] = await CampanhaDestinatarioModel.update(CAMPOS_RESET_REENVIO_DESTINATARIO, {
    where: {
      campanha_id: campanhaId,
      status: { [Op.in]: ["cancelado", "erro"] },
    },
  });
  return total;
}

async function reiniciarEnvioCampanha(campanhaId, options = {}) {
  const totalResetados = await resetarDestinatariosCanceladosEErros(campanhaId);
  if (!totalResetados) {
    return { totalResetados: 0, campanha: null, totalEnfileirado: 0, primeiroAgendadoPara: null };
  }
  const resultado = await prepararEEnfileirarCampanha(campanhaId, options);
  return {
    totalResetados,
    campanha: resultado?.campanha ?? null,
    totalEnfileirado: resultado?.totalEnfileirado ?? 0,
    primeiroAgendadoPara: resultado?.primeiroAgendadoPara ?? null,
  };
}

async function prepararEEnfileirarCampanha(campanhaId, options = {}) {
  const campanha = await CampanhaDivulgacaoModel.findByPk(campanhaId);
  if (!campanha) return null;

  const pendentes = await CampanhaDestinatarioModel.findAll({
    where: { campanha_id: campanhaId, status: "pendente" },
    order: [["ordem", "ASC"]],
  });

  if (!pendentes.length) {
    await campanha.update({ status: "finalizada" });
    await campanha.reload();
    return { campanha, totalEnfileirado: 0, primeiroAgendadoPara: null };
  }

  const usados = new Set();
  const disparoEm =
    options.disparoEm instanceof Date && !Number.isNaN(options.disparoEm.getTime())
      ? options.disparoEm
      : new Date();
  const mensagensPorTurno = Math.max(1, Number(campanha.mensagens_por_turno || 2));

  await sequelize.transaction(async (transaction) => {
    for (let i = 0; i < pendentes.length; i += 1) {
      const p = pendentes[i];
      const { turno, agendadoPara } = gerarAgendamentoPorDisparo(i, mensagensPorTurno, disparoEm, usados);
      await p.update(
        {
          turno,
          agendado_para: agendadoPara,
        },
        { transaction },
      );
    }
  });

  const pendentesReagendados = pendentes.map((p) => ({
    id: p.id,
    campanha_id: p.campanha_id,
    agendado_para: p.agendado_para,
  }));

  await validarFilaDisponivel();
  await enfileirarDestinatarios(pendentesReagendados);
  await campanha.update({ status: "em_andamento" });
  await campanha.reload();

  const primeiroAgendadoPara = pendentesReagendados.length
    ? pendentesReagendados.reduce((min, item) => {
        const ts = new Date(item.agendado_para).getTime();
        if (!Number.isFinite(ts)) return min;
        if (!min) return item.agendado_para;
        return ts < new Date(min).getTime() ? item.agendado_para : min;
      }, null)
    : null;

  return { campanha, totalEnfileirado: pendentes.length, primeiroAgendadoPara };
}

const ENGAJAMENTOS_PAINEL = ["sem_resposta", "positivo", "negativo", "neutro"];

function normalizarEngajamentoPainel(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return ENGAJAMENTOS_PAINEL.includes(v) ? v : null;
}

function mapaEngajamentoZerado() {
  return { sem_resposta: 0, positivo: 0, negativo: 0, neutro: 0, total: 0 };
}

function parsePaginaPainel(query) {
  const page = Math.max(1, parseInt(String(query?.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(10, parseInt(String(query?.limit ?? "50"), 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

/** Mesma regra do painel (COALESCE) para listagem bater com os totais dos cards. */
function whereEngajamentoPessoa(engajamento) {
  if (!engajamento) return {};

  if (engajamento === "sem_resposta") {
    return {
      [Op.or]: [
        { engajamentoWhatsapp: "sem_resposta" },
        { engajamentoWhatsapp: "" },
        { engajamentoWhatsapp: null },
      ],
    };
  }

  return { engajamentoWhatsapp: engajamento };
}

function normalizarFiltroPainelPessoas(value) {
  const v = String(value ?? "engajamento").trim().toLowerCase();
  if (v === "campanha_sem_resposta") return "campanha_sem_resposta";
  if (v === "campanha_enviados") return "campanha_enviados";
  return "engajamento";
}

/** Engajamento consolidado só desta campanha (respostas do destinatário), não o cadastro global da pessoa. */
function engajamentoCampanhaDestinatario(dest) {
  return (
    engajamentoDasSentimentosRespondidos(
      dest?.resposta_1_sentimento,
      dest?.resposta_2_sentimento,
    ) || "sem_resposta"
  );
}

/** Engajamento usado para escolher qual resposta recebida exibir. */
function engajamentoExibicaoDestinatario(dest, opts = {}) {
  if (opts.engajamento) return opts.engajamento;
  const naCampanha = engajamentoCampanhaDestinatario(dest);
  if (naCampanha !== "sem_resposta") return naCampanha;
  return normalizarEngajamentoPainel(dest?.PessoaModel?.engajamentoWhatsapp);
}

function mensagemPainelDestinatario(dest, opts = {}) {
  if (!dest) return null;

  const filtro = opts.filtro || "engajamento";
  if (filtro === "campanha_sem_resposta") {
    return null;
  }

  const eng = engajamentoExibicaoDestinatario(dest, opts);
  if (!eng || eng === "sem_resposta") {
    return null;
  }

  return textosRespostaParaEngajamentoPainel(
    dest.resposta_1_texto,
    dest.resposta_2_texto,
    dest.resposta_1_sentimento,
    dest.resposta_2_sentimento,
    eng,
  );
}

function includePainelDestinatario(candidatoId) {
  return [
    {
      model: PessoaModel,
      required: true,
      where: { candidatoId },
      include: [{ model: EnderecoModel, required: false }],
    },
  ];
}

function serializarPessoaPainel(p, extra = {}) {
  return {
    id: p.id,
    nome: p.nome,
    whatsapp: p.whatsapp ?? null,
    engajamento_whatsapp: String(p.engajamentoWhatsapp || "sem_resposta"),
    bairro: p.EnderecoModel?.bairro ?? null,
    erro_whatsapp: Boolean(p.erroWhatsapp),
    ...extra,
  };
}

function serializarPessoaPainelDestinatario(dest, opts = {}) {
  const p = dest?.PessoaModel;
  if (!p) return null;
  const mensagem = mensagemPainelDestinatario(dest, opts);
  return serializarPessoaPainel(p, {
    destinatario_id: dest.id,
    campanha_id: dest.campanha_id,
    engajamento_whatsapp: engajamentoCampanhaDestinatario(dest),
    enviado_em: dest.enviado_em ?? null,
    mensagem: mensagem ?? null,
    mensagem_tipo: mensagem ? "resposta" : null,
  });
}

function timestampRespostasDestinatario(d) {
  const t1 = d.resposta_1_em ? new Date(d.resposta_1_em).getTime() : 0;
  const t2 = d.resposta_2_em ? new Date(d.resposta_2_em).getTime() : 0;
  return Math.max(t1, t2);
}

function mensagemRespostaPessoaPorEngajamento(dests, engajamento) {
  let melhorMsg = null;
  let melhorTs = 0;
  for (const d of dests) {
    const consolidado = engajamentoDasSentimentosRespondidos(
      d.resposta_1_sentimento,
      d.resposta_2_sentimento,
    );
    if (consolidado !== engajamento) continue;
    const msg = textosRespostaParaEngajamentoPainel(
      d.resposta_1_texto,
      d.resposta_2_texto,
      d.resposta_1_sentimento,
      d.resposta_2_sentimento,
      engajamento,
    );
    if (!msg) continue;
    const ts = timestampRespostasDestinatario(d);
    if (ts >= melhorTs) {
      melhorTs = ts;
      melhorMsg = msg;
    }
  }
  return melhorMsg;
}

async function serializarPessoasPainelComMensagemResposta(pessoas, engajamento, candidatoId) {
  if (!engajamento || engajamento === "sem_resposta" || !pessoas.length) {
    return pessoas.map((p) => serializarPessoaPainel(p, { mensagem: null, mensagem_tipo: null }));
  }

  const ids = pessoas.map((p) => p.id);
  const dests = await CampanhaDestinatarioModel.findAll({
    attributes: [
      "pessoa_id",
      "resposta_1_texto",
      "resposta_2_texto",
      "resposta_1_sentimento",
      "resposta_2_sentimento",
      "resposta_1_em",
      "resposta_2_em",
    ],
    include: [
      {
        model: PessoaModel,
        attributes: [],
        required: true,
        where: { candidatoId, id: { [Op.in]: ids } },
      },
    ],
  });

  const porPessoa = new Map();
  for (const d of dests) {
    const pid = Number(d.pessoa_id);
    if (!porPessoa.has(pid)) porPessoa.set(pid, []);
    porPessoa.get(pid).push(d);
  }

  return pessoas.map((p) => {
    const mensagem = mensagemRespostaPessoaPorEngajamento(porPessoa.get(p.id) || [], engajamento);
    return serializarPessoaPainel(p, {
      mensagem: mensagem ?? null,
      mensagem_tipo: mensagem ? "resposta" : null,
    });
  });
}

router.get("/painel", ...apenasAdmin, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const engRows = await sequelize.query(
      `
      SELECT COALESCE(NULLIF(TRIM(engajamento_whatsapp), ''), 'sem_resposta') AS engajamento,
             COUNT(*)::integer AS quantidade
      FROM pessoa
      WHERE candidato_id = :candidatoId
      GROUP BY 1
      `,
      { replacements: { candidatoId }, type: QueryTypes.SELECT },
    );

    const engajamento = mapaEngajamentoZerado();
    for (const row of engRows) {
      const key = normalizarEngajamentoPainel(row.engajamento) || "sem_resposta";
      engajamento[key] += Number(row.quantidade || 0);
      engajamento.total += Number(row.quantidade || 0);
    }

    const campanhas = await CampanhaDivulgacaoModel.findAll({
      where: { candidatoId },
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
    });

    const ids = campanhas.map((c) => c.id);
    const sentConsolidado = sqlExprSentimentoConsolidadoDestinatario();
    const aggDest = ids.length
      ? await CampanhaDestinatarioModel.findAll({
          attributes: [
            "campanha_id",
            [sequelize.fn("COUNT", sequelize.col("id")), "total"],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN status = 'enviado' THEN 1 ELSE 0 END`),
              ),
              "enviados",
            ],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(
                  `CASE WHEN resposta_1_texto IS NOT NULL OR resposta_2_texto IS NOT NULL THEN 1 ELSE 0 END`,
                ),
              ),
              "com_resposta",
            ],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(
                  `CASE WHEN status = 'enviado' AND resposta_1_texto IS NULL AND resposta_2_texto IS NULL THEN 1 ELSE 0 END`,
                ),
              ),
              "sem_resposta_envio",
            ],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN ${sentConsolidado} = 'positivo' THEN 1 ELSE 0 END`),
              ),
              "positivo",
            ],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN ${sentConsolidado} = 'negativo' THEN 1 ELSE 0 END`),
              ),
              "negativo",
            ],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN ${sentConsolidado} = 'neutro' THEN 1 ELSE 0 END`),
              ),
              "neutro",
            ],
          ],
          where: { campanha_id: ids },
          group: ["campanha_id"],
          raw: true,
        })
      : [];

    const aggMap = new Map(
      aggDest.map((a) => [
        Number(a.campanha_id),
        {
          total: Number(a.total || 0),
          enviados: Number(a.enviados || 0),
          com_resposta: Number(a.com_resposta || 0),
          sem_resposta_envio: Number(a.sem_resposta_envio || 0),
          positivo: Number(a.positivo || 0),
          negativo: Number(a.negativo || 0),
          neutro: Number(a.neutro || 0),
        },
      ]),
    );

    const campanhasPainel = campanhas.map((c) => {
      const agg = aggMap.get(c.id) || {
        total: 0,
        enviados: 0,
        com_resposta: 0,
        sem_resposta_envio: 0,
        positivo: 0,
        negativo: 0,
        neutro: 0,
      };
      return {
        id: c.id,
        nome: c.nome,
        status: c.status,
        total_destinatarios: c.total_destinatarios ?? agg.total,
        total_enviados: c.total_enviados ?? agg.enviados,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        respostas: {
          com_resposta: agg.com_resposta,
          sem_resposta: agg.sem_resposta_envio,
          positivo: agg.positivo,
          negativo: agg.negativo,
          neutro: agg.neutro,
        },
      };
    });

    const campanhasRealizadas = campanhas.filter((c) =>
      ["finalizada", "em_andamento", "cancelada", "montada"].includes(String(c.status)),
    ).length;

    return res.json({
      totais: {
        pessoas_cadastradas: engajamento.total,
        campanhas: campanhas.length,
        campanhas_realizadas: campanhasRealizadas,
      },
      engajamento,
      campanhas: campanhasPainel,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/painel/pessoas", ...apenasAdmin, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const engajamento = normalizarEngajamentoPainel(req.query?.engajamento);
    const campanhaId = Number(req.query?.campanha_id);
    const { page, limit, offset } = parsePaginaPainel(req.query);
    const filtro = normalizarFiltroPainelPessoas(req.query?.filtro);

    if (filtro === "campanha_sem_resposta") {
      if (!Number.isInteger(campanhaId) || campanhaId <= 0) {
        return res.status(400).json({ message: "Informe campanha_id para listar sem resposta na campanha." });
      }
      const campanha = await CampanhaDivulgacaoModel.findOne({
        where: { id: campanhaId, candidatoId },
        attributes: ["id", "nome"],
      });
      if (!campanha) {
        return res.status(404).json({ message: "Campanha não encontrada." });
      }

      const whereDest = {
        campanha_id: campanhaId,
        status: "enviado",
        resposta_1_texto: null,
        resposta_2_texto: null,
      };

      const { count, rows: destinatarios } = await CampanhaDestinatarioModel.findAndCountAll({
        where: whereDest,
        include: includePainelDestinatario(candidatoId),
        order: [["ordem", "ASC"]],
        limit,
        offset,
        distinct: true,
      });

      return res.json({
        filtro: "campanha_sem_resposta",
        engajamento: null,
        campanha_id: campanhaId,
        campanha_nome: campanha.nome,
        total: count,
        page,
        limit,
        pessoas: destinatarios
          .map((d) => serializarPessoaPainelDestinatario(d, { filtro: "campanha_sem_resposta" }))
          .filter(Boolean),
      });
    }

    if (filtro === "campanha_enviados") {
      if (!Number.isInteger(campanhaId) || campanhaId <= 0) {
        return res.status(400).json({ message: "Informe campanha_id para listar enviados na campanha." });
      }
      const campanha = await CampanhaDivulgacaoModel.findOne({
        where: { id: campanhaId, candidatoId },
        attributes: ["id", "nome"],
      });
      if (!campanha) {
        return res.status(404).json({ message: "Campanha não encontrada." });
      }

      const { count, rows: destinatarios } = await CampanhaDestinatarioModel.findAndCountAll({
        where: { campanha_id: campanhaId, status: "enviado" },
        include: includePainelDestinatario(candidatoId),
        order: [[{ model: PessoaModel }, "nome", "ASC"]],
        limit,
        offset,
        distinct: true,
      });

      return res.json({
        filtro: "campanha_enviados",
        engajamento: null,
        campanha_id: campanhaId,
        campanha_nome: campanha.nome,
        total: count,
        page,
        limit,
        pessoas: destinatarios
          .map((d) => serializarPessoaPainelDestinatario(d, { filtro: "campanha_enviados" }))
          .filter(Boolean),
      });
    }

    let campanhaNome = null;
    const temCampanha = Number.isInteger(campanhaId) && campanhaId > 0;

    if (temCampanha) {
      const campanha = await CampanhaDivulgacaoModel.findOne({
        where: { id: campanhaId, candidatoId },
        attributes: ["id", "nome"],
      });
      if (!campanha) {
        return res.status(404).json({ message: "Campanha não encontrada." });
      }
      campanhaNome = campanha.nome;

      if (engajamento) {
        const sentExpr = sqlExprSentimentoConsolidadoDestinatario("cd");
        const [totalRow] = await sequelize.query(
          `
          SELECT COUNT(*)::integer AS total
          FROM campanha_destinatario cd
          INNER JOIN pessoa p ON p.id = cd.pessoa_id AND p.candidato_id = :candidatoId
          WHERE cd.campanha_id = :campanhaId
            AND (${sentExpr}) = :engajamento
          `,
          {
            replacements: { campanhaId, engajamento, candidatoId },
            type: QueryTypes.SELECT,
          },
        );
        const total = Number(totalRow?.total || 0);
        if (!total) {
          return res.json({
            filtro: "engajamento",
            engajamento,
            campanha_id: campanhaId,
            campanha_nome: campanhaNome,
            total: 0,
            page,
            limit,
            pessoas: [],
          });
        }

        const idsRows = await sequelize.query(
          `
          SELECT cd.id
          FROM campanha_destinatario cd
          INNER JOIN pessoa p ON p.id = cd.pessoa_id AND p.candidato_id = :candidatoId
          WHERE cd.campanha_id = :campanhaId
            AND (${sentExpr}) = :engajamento
          ORDER BY p.nome ASC
          LIMIT :limit OFFSET :offset
          `,
          {
            replacements: { campanhaId, engajamento, candidatoId, limit, offset },
            type: QueryTypes.SELECT,
          },
        );
        const idsDestinatarios = idsRows.map((r) => Number(r.id)).filter((id) => id > 0);
        if (!idsDestinatarios.length) {
          return res.json({
            filtro: "engajamento",
            engajamento,
            campanha_id: campanhaId,
            campanha_nome: campanhaNome,
            total,
            page,
            limit,
            pessoas: [],
          });
        }

        const destinatarios = await CampanhaDestinatarioModel.findAll({
          where: { id: { [Op.in]: idsDestinatarios } },
          include: includePainelDestinatario(candidatoId),
        });
        const ordemIds = new Map(idsDestinatarios.map((id, idx) => [id, idx]));
        destinatarios.sort(
          (a, b) => (ordemIds.get(a.id) ?? 0) - (ordemIds.get(b.id) ?? 0),
        );

        return res.json({
          filtro: "engajamento",
          engajamento,
          campanha_id: campanhaId,
          campanha_nome: campanhaNome,
          total,
          page,
          limit,
          pessoas: destinatarios
            .map((d) => serializarPessoaPainelDestinatario(d, { filtro: "engajamento", engajamento }))
            .filter(Boolean),
        });
      }

      const dests = await CampanhaDestinatarioModel.findAll({
        where: { campanha_id: campanhaId },
        attributes: ["pessoa_id"],
        raw: true,
      });
      const pessoaIdsCampanha = [...new Set(dests.map((d) => Number(d.pessoa_id)).filter((id) => id > 0))];
      if (!pessoaIdsCampanha.length) {
        return res.json({
          filtro: "engajamento",
          engajamento: engajamento || null,
          campanha_id: campanhaId,
          campanha_nome: campanhaNome,
          total: 0,
          page,
          limit,
          pessoas: [],
        });
      }

      const wherePessoaCampanha = {
        candidatoId,
        id: { [Op.in]: pessoaIdsCampanha },
        ...whereEngajamentoPessoa(engajamento),
      };

      const { count, rows: pessoas } = await PessoaModel.findAndCountAll({
        where: wherePessoaCampanha,
        include: [{ model: EnderecoModel, required: false }],
        order: [["nome", "ASC"]],
        limit,
        offset,
        distinct: true,
      });

      const pessoasSerializadas = engajamento
        ? await serializarPessoasPainelComMensagemResposta(pessoas, engajamento, candidatoId)
        : pessoas.map((p) => serializarPessoaPainel(p));

      return res.json({
        filtro: "engajamento",
        engajamento: engajamento || null,
        campanha_id: campanhaId,
        campanha_nome: campanhaNome,
        total: count,
        page,
        limit,
        pessoas: pessoasSerializadas,
      });
    }

    const wherePessoa = {
      candidatoId,
      ...whereEngajamentoPessoa(engajamento),
    };

    const { count, rows: pessoas } = await PessoaModel.findAndCountAll({
      where: wherePessoa,
      include: [{ model: EnderecoModel, required: false }],
      order: [["nome", "ASC"]],
      limit,
      offset,
      distinct: true,
    });

    const pessoasPainel = engajamento
      ? await serializarPessoasPainelComMensagemResposta(pessoas, engajamento, candidatoId)
      : pessoas.map((p) => serializarPessoaPainel(p));

    return res.json({
      filtro: "engajamento",
      engajamento: engajamento || null,
      campanha_id: null,
      campanha_nome: campanhaNome,
      total: count,
      page,
      limit,
      pessoas: pessoasPainel,
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/painel/destinatario-engajamento", ...apenasAdmin, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const destinatarioId = Number(req.body?.destinatario_id);
    const engajamento = normalizarEngajamentoManual(req.body?.engajamento);

    if (!Number.isInteger(destinatarioId) || destinatarioId <= 0) {
      return res.status(400).json({ message: "Informe destinatario_id válido." });
    }
    if (!engajamento) {
      return res.status(400).json({
        message: "Engajamento inválido. Use: sem_resposta, positivo, negativo ou neutro.",
      });
    }

    const dest = await aplicarEngajamentoManualDestinatario(destinatarioId, engajamento, {
      candidatoId,
    });
    if (!dest) {
      return res.status(404).json({ message: "Destinatário não encontrado nesta campanha." });
    }

    const destCompleto = await CampanhaDestinatarioModel.findByPk(dest.id, {
      include: includePainelDestinatario(candidatoId),
    });
    const pessoa = serializarPessoaPainelDestinatario(destCompleto, {
      filtro: "engajamento",
      engajamento,
    });

    return res.json({ pessoa });
  } catch (err) {
    if (err?.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
});

router.get("/", ...apenasAdmin, async (req, res, next) => {
  try {
    const campanhas = await CampanhaDivulgacaoModel.findAll({
      where: { candidatoId: req.auth.CandidatoId },
      include: [
        {
          model: WhatsappCanalModel,
          attributes: ["id", "nome", "numero", "status"],
          required: false,
        },
      ],
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
    });

    const ids = campanhas.map((c) => c.id);
    const agregados = ids.length
      ? await CampanhaDestinatarioModel.findAll({
          attributes: [
            "campanha_id",
            [sequelize.fn("COUNT", sequelize.col("id")), "total"],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN status = 'enviado' THEN 1 ELSE 0 END`),
              ),
              "enviados",
            ],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN status = 'pendente' THEN 1 ELSE 0 END`),
              ),
              "pendentes",
            ],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END`),
              ),
              "cancelados",
            ],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN status = 'erro' THEN 1 ELSE 0 END`),
              ),
              "erros",
            ],
          ],
          where: { campanha_id: ids },
          group: ["campanha_id"],
          raw: true,
        })
      : [];

    const map = new Map(
      agregados.map((a) => [
        Number(a.campanha_id),
        {
          total: Number(a.total || 0),
          enviados: Number(a.enviados || 0),
          pendentes: Number(a.pendentes || 0),
          cancelados: Number(a.cancelados || 0),
          erros: Number(a.erros || 0),
        },
      ]),
    );

    return res.json(
      campanhas.map((c) => {
        const agg = map.get(c.id) || {
          total: 0,
          enviados: 0,
          pendentes: 0,
          cancelados: 0,
          erros: 0,
        };
        const canal = c.WhatsappCanalModel;
        return {
          id: c.id,
          nome: c.nome,
          status: c.status,
          mensagens_por_turno: c.mensagens_por_turno ?? 2,
          whatsapp_canal_id: c.whatsapp_canal_id ?? null,
          whatsapp_canal: canal
            ? {
                id: canal.id,
                nome: canal.nome,
                numero: canal.numero,
                status: canal.status,
              }
            : null,
          total_destinatarios: c.total_destinatarios ?? agg.total,
          total_enviados: c.total_enviados ?? agg.enviados,
          total_pendentes: agg.pendentes,
          total_cancelados: agg.cancelados,
          total_erros: agg.erros,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/:id", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
      include: [
        {
          model: WhatsappCanalModel,
          attributes: ["id", "nome", "numero", "status"],
          required: false,
        },
      ],
    });
    if (!campanha) return res.status(404).json({ message: "Campanha nao encontrada." });
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");

    const itens = await CampanhaDestinatarioModel.findAll({
      where: { campanha_id: id },
      include: [
        {
          model: PessoaModel,
          attributes: ["id", "nome", "whatsapp"],
          include: [
            { model: EnderecoModel, attributes: ["bairro", "cidade"], required: false },
            { model: UsuarioModel, attributes: ["nome"], required: false },
          ],
        },
        { model: ModeloMensagemModel, attributes: ["id", "titulo", "corpo"] },
      ],
      order: [["ordem", "ASC"]],
    });

    const canal = campanha.WhatsappCanalModel;
    return res.json({
      id: campanha.id,
      nome: campanha.nome,
      status: campanha.status,
      mensagens_por_turno: campanha.mensagens_por_turno ?? 2,
      whatsapp_canal_id: campanha.whatsapp_canal_id ?? null,
      whatsapp_canal: canal
        ? {
            id: canal.id,
            nome: canal.nome,
            numero: canal.numero,
            status: canal.status,
          }
        : null,
      total_destinatarios: campanha.total_destinatarios,
      total_enviados: campanha.total_enviados,
      createdAt: campanha.createdAt,
      updatedAt: campanha.updatedAt,
      destinatarios: itens.map((item) => ({
        id: item.id,
        ordem: item.ordem,
        status: item.status,
        turno: item.turno ?? null,
        agendado_para: item.agendado_para ?? null,
        tentativas: item.tentativas,
        enviado_em: item.enviado_em,
        falha_entrega: item.falha_entrega ?? false,
        falha_codigo: item.falha_codigo ?? null,
        falha_em: item.falha_em ?? null,
        erro_ultimo: item.erro_ultimo,
        wa_message_id_envio: item.wa_message_id_envio ?? null,
        resposta_1_texto: item.resposta_1_texto ?? null,
        resposta_1_em: item.resposta_1_em ?? null,
        resposta_1_sentimento: item.resposta_1_sentimento ?? null,
        resposta_2_texto: item.resposta_2_texto ?? null,
        resposta_2_em: item.resposta_2_em ?? null,
        resposta_2_sentimento: item.resposta_2_sentimento ?? null,
        pessoa: item.PessoaModel
          ? {
              id: item.PessoaModel.id,
              nome: item.PessoaModel.nome,
              whatsapp: item.PessoaModel.whatsapp,
              bairro: item.PessoaModel.EnderecoModel?.bairro ?? item.PessoaModel.EnderecoModel?.cidade ?? null,
              nome_coordenador: item.PessoaModel.UsuarioModel?.nome ?? null,
            }
          : null,
        modelo: item.ModeloMensagemModel
          ? {
              id: item.ModeloMensagemModel.id,
              titulo: item.ModeloMensagemModel.titulo,
              corpo: item.ModeloMensagemModel.corpo ?? null,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", ...apenasAdmin, async (req, res, next) => {
  try {
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const campanhaAniversariantes = campanhaEhAniversariantes(nome);
    const pessoaIds = Array.isArray(req.body?.pessoa_ids) ? req.body.pessoa_ids.map(Number) : [];
    const modeloIds = Array.isArray(req.body?.modelo_ids) ? req.body.modelo_ids.map(Number) : [];
    const mensagensPorTurnoRaw = Number(req.body?.mensagens_por_turno ?? 2);
    const mensagensPorTurno = Number.isInteger(mensagensPorTurnoRaw)
      ? Math.max(1, Math.min(MAX_MENSAGENS_POR_TURNO, mensagensPorTurnoRaw))
      : 2;
    const whatsappCanalId = Number(req.body?.whatsapp_canal_id);

    const pessoaIdsValidos = [...new Set(pessoaIds.filter((id) => Number.isInteger(id) && id > 0))];
    const modeloIdsValidos = [...new Set(modeloIds.filter((id) => Number.isInteger(id) && id > 0))];

    if (!nome) return res.status(400).json({ message: "Informe o nome da campanha." });
    if (!Number.isInteger(whatsappCanalId) || whatsappCanalId <= 0) {
      return res.status(400).json({ message: "Selecione o celular (canal WhatsApp) que enviara a campanha." });
    }

    const canalWhatsapp = await WhatsappCanalModel.findOne({
      where: { id: whatsappCanalId, candidatoId: req.auth.CandidatoId },
    });
    if (!canalWhatsapp) {
      return res.status(400).json({ message: "Canal WhatsApp selecionado nao encontrado." });
    }

    if (!pessoaIdsValidos.length)
      return res.status(400).json({ message: "Selecione pelo menos uma pessoa." });
    if (campanhaAniversariantes && modeloIdsValidos.length !== 1) {
      return res
        .status(400)
        .json({ message: "Para campanha de aniversariantes, selecione obrigatoriamente 1 modelo." });
    }
    if (!campanhaAniversariantes && modeloIdsValidos.length < 2) {
      return res
        .status(400)
        .json({ message: "Selecione obrigatoriamente 2 ou mais modelos diferentes." });
    }

    const pessoas = await PessoaModel.findAll({
      where: { id: pessoaIdsValidos, candidatoId: req.auth.CandidatoId },
      attributes: ["id", "nome", "whatsapp"],
      order: [["nome", "ASC"]],
    });
    if (pessoas.length !== pessoaIdsValidos.length) {
      return res.status(400).json({ message: "Uma ou mais pessoas selecionadas nao foram encontradas." });
    }

    const pessoasSemWhatsapp = pessoas.filter((p) => limparNumeros(p.whatsapp).length === 0);
    if (pessoasSemWhatsapp.length) {
      return res.status(400).json({
        message: "Existem pessoas sem WhatsApp valido na selecao.",
        pessoas: pessoasSemWhatsapp.map((p) => p.nome),
      });
    }

    const modelos = await ModeloMensagemModel.findAll({
      where: { id: modeloIdsValidos, candidatoId: req.auth.CandidatoId },
      attributes: ["id", "titulo"],
      order: [["titulo", "ASC"]],
    });
    if (modelos.length !== modeloIdsValidos.length) {
      return res.status(400).json({ message: "Um ou mais modelos selecionados nao foram encontrados." });
    }

    const deveParticionar = pessoas.length > MAX_PESSOAS_POR_CAMPANHA;
    const lotes = deveParticionar
      ? particionarLista(pessoas, MAX_PESSOAS_POR_CAMPANHA)
      : [pessoas];
    const dataParte = labelDataCriacaoSP();

    const criadas = await sequelize.transaction(async (transaction) => {
      const resultados = [];
      for (let i = 0; i < lotes.length; i += 1) {
        const lote = lotes[i];
        const nomeCampanha = deveParticionar
          ? nomeCampanhaComParte(nome, i + 1, dataParte)
          : nome;

        const campanha = await CampanhaDivulgacaoModel.create(
          {
            nome: nomeCampanha,
            status: "montada",
            total_destinatarios: lote.length,
            total_enviados: 0,
            mensagens_por_turno: mensagensPorTurno,
            usuario_id: req.auth?.UsuarioId ?? null,
            candidatoId: req.auth.CandidatoId,
            whatsapp_canal_id: canalWhatsapp.id,
          },
          { transaction },
        );

        const payloadDestinatarios = lote.map((pessoa, index) => {
          const modelo = modelos[index % modelos.length];
          return {
            campanha_id: campanha.id,
            pessoa_id: pessoa.id,
            modelo_mensagem_id: modelo.id,
            ordem: index + 1,
            whatsapp: limparNumeros(pessoa.whatsapp).slice(0, 20),
            turno: "manha",
            agendado_para: null,
            status: "pendente",
            tentativas: 0,
          };
        });

        await CampanhaDestinatarioModel.bulkCreate(payloadDestinatarios, { transaction });
        resultados.push(campanha);
      }
      return resultados;
    });

    const primeira = criadas[0];
    const totalDestinatarios = criadas.reduce((acc, c) => acc + (c.total_destinatarios ?? 0), 0);
    const message =
      criadas.length === 1
        ? "Campanha criada com sucesso."
        : `${criadas.length} campanhas criadas com sucesso (máximo de ${MAX_PESSOAS_POR_CAMPANHA} pessoas por parte).`;

    return res.status(201).json({
      id: primeira.id,
      message,
      status: primeira.status,
      mensagens_por_turno: primeira.mensagens_por_turno,
      total_destinatarios: totalDestinatarios,
      total_campanhas: criadas.length,
      campanhas: criadas.map((c) => ({
        id: c.id,
        nome: c.nome,
        status: c.status,
        total_destinatarios: c.total_destinatarios,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const loginExcluir = String(req.auth.preferred_username ?? "").trim().toLowerCase();
    if (loginExcluir !== "admin") {
      return res.status(403).json({
        message: "Apenas o usuario com login admin pode excluir campanhas.",
      });
    }

    const campanha = await CampanhaDivulgacaoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    if (String(campanha.status) === "em_andamento") {
      return res.status(400).json({
        message: "Campanhas em andamento nao podem ser excluidas. Cancele o envio antes.",
      });
    }

    const jobsRemovidos = await removerTodosJobsDaCampanha(id);

    await sequelize.transaction(async (transaction) => {
      await CampanhaDestinatarioModel.destroy({
        where: { campanha_id: id },
        transaction,
      });
      await campanha.destroy({ transaction });
    });

    return res.status(200).json({
      message: `Campanha excluida com sucesso (${jobsRemovidos} job(s) removido(s) da fila).`,
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/whatsapp-canal", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const whatsappCanalId = Number(req.body?.whatsapp_canal_id);
    if (!Number.isInteger(whatsappCanalId) || whatsappCanalId <= 0) {
      return res.status(400).json({ message: "Selecione o celular (canal WhatsApp) da campanha." });
    }

    const campanha = await CampanhaDivulgacaoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    if (!STATUS_EDITAVEIS_ANTES_DO_ENVIO.includes(String(campanha.status))) {
      return res.status(400).json({
        message: "So e possivel alterar o celular antes de iniciar ou reiniciar o envio.",
      });
    }

    const canalWhatsapp = await WhatsappCanalModel.findOne({
      where: { id: whatsappCanalId, candidatoId: req.auth.CandidatoId },
      attributes: ["id", "nome", "numero", "status"],
    });
    if (!canalWhatsapp) {
      return res.status(400).json({ message: "Canal WhatsApp selecionado nao encontrado." });
    }

    await campanha.update({ whatsapp_canal_id: canalWhatsapp.id });

    return res.status(200).json({
      id: campanha.id,
      status: campanha.status,
      whatsapp_canal_id: canalWhatsapp.id,
      whatsapp_canal: {
        id: canalWhatsapp.id,
        nome: canalWhatsapp.nome,
        numero: canalWhatsapp.numero,
        status: canalWhatsapp.status,
      },
      message: "Celular da campanha atualizado com sucesso.",
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/mensagens-por-turno", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const valor = Number(req.body?.mensagens_por_turno);
    if (!Number.isInteger(valor) || valor < 1 || valor > MAX_MENSAGENS_POR_TURNO) {
      return res.status(400).json({
        message: `Informe mensagens por turno entre 1 e ${MAX_MENSAGENS_POR_TURNO}.`,
      });
    }

    const campanha = await CampanhaDivulgacaoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    // O agendamento é recalculado ao iniciar/reiniciar, por isso a edição só faz
    // sentido antes desse momento.
    if (!STATUS_EDITAVEIS_ANTES_DO_ENVIO.includes(String(campanha.status))) {
      return res.status(400).json({
        message: "As mensagens por turno so podem ser alteradas antes de iniciar ou reiniciar o envio.",
      });
    }

    await campanha.update({ mensagens_por_turno: valor });

    return res.status(200).json({
      id: campanha.id,
      status: campanha.status,
      mensagens_por_turno: valor,
      message: "Mensagens por turno atualizadas com sucesso.",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/iniciar", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    const loginIniciar = String(req.auth.preferred_username ?? "").trim().toLowerCase();
    const ehAniversario = campanhaEhAniversariantes(campanha.nome);
    if (loginIniciar !== "admin" && !ehAniversario) {
      return res.status(403).json({
        message: "Apenas o usuario com login admin pode iniciar o envio da campanha.",
      });
    }

    const disparo = resolverDisparoInicio(req.body);
    if (disparo.error) {
      return res.status(400).json({ message: disparo.error });
    }
    const { modo, disparoEm } = disparo;

    if (String(campanha.status) === "cancelada") {
      return res.status(400).json({
        message: "Campanha cancelada nao pode ser iniciada. Use Reiniciar envio.",
      });
    }
    const canal = await validarCanalWhatsappCampanha(campanha, req.auth.CandidatoId, "iniciar");
    if (canal.error) {
      return res.status(400).json({ message: canal.error });
    }

    const conflitoCanal = await campanhaEmAndamentoNoMesmoCanal(
      req.auth.CandidatoId,
      campanha.whatsapp_canal_id,
      id,
    );
    if (conflitoCanal) {
      return res.status(409).json({
        message: mensagemConflitoCanalEmAndamento(conflitoCanal, canal.canalRow?.nome),
      });
    }

    const { campanha: atualizada, totalEnfileirado, primeiroAgendadoPara } =
      await prepararEEnfileirarCampanha(id, { disparoEm });
    let message;
    if (!totalEnfileirado) {
      message = "Campanha sem destinatarios pendentes para envio.";
    } else if (modo === "agendar" && primeiroAgendadoPara) {
      message = `Campanha agendada com sucesso (${totalEnfileirado} destinatario(s)). Primeiro envio previsto para ${new Date(primeiroAgendadoPara).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`;
    } else {
      message = `Campanha enfileirada com sucesso (${totalEnfileirado} destinatario(s)).`;
    }
    return res.status(200).json({
      id,
      status: atualizada?.status ?? "finalizada",
      agendado: modo === "agendar",
      primeiro_agendado_para: primeiroAgendadoPara ?? null,
      message,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reiniciar", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    const loginReiniciar = String(req.auth.preferred_username ?? "").trim().toLowerCase();
    const ehAniversario = campanhaEhAniversariantes(campanha.nome);
    if (loginReiniciar !== "admin" && !ehAniversario) {
      return res.status(403).json({
        message: "Apenas o usuario com login admin pode reiniciar o envio da campanha.",
      });
    }

    if (String(campanha.status) !== "cancelada") {
      return res.status(400).json({
        message: "Somente campanhas canceladas podem ser reiniciadas.",
      });
    }

    const disparo = resolverDisparoInicio(req.body);
    if (disparo.error) {
      return res.status(400).json({ message: disparo.error });
    }
    const { modo, disparoEm } = disparo;

    const canal = await validarCanalWhatsappCampanha(campanha, req.auth.CandidatoId, "reiniciar");
    if (canal.error) {
      return res.status(400).json({ message: canal.error });
    }

    const conflitoCanal = await campanhaEmAndamentoNoMesmoCanal(
      req.auth.CandidatoId,
      campanha.whatsapp_canal_id,
      id,
    );
    if (conflitoCanal) {
      return res.status(409).json({
        message: mensagemConflitoCanalEmAndamento(conflitoCanal, canal.canalRow?.nome),
      });
    }

    const { totalResetados, campanha: atualizada, totalEnfileirado, primeiroAgendadoPara } =
      await reiniciarEnvioCampanha(id, { disparoEm });

    if (!totalResetados) {
      return res.status(400).json({
        message: "Nao ha destinatarios cancelados ou com erro para reiniciar nesta campanha.",
      });
    }

    let message;
    if (!totalEnfileirado) {
      message = "Nenhum destinatario foi enfileirado apos o reinicio.";
    } else if (modo === "agendar" && primeiroAgendadoPara) {
      message = `Campanha reiniciada e agendada (${totalEnfileirado} destinatario(s)). Primeiro envio previsto para ${new Date(primeiroAgendadoPara).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`;
    } else {
      message = `Campanha reiniciada com sucesso (${totalEnfileirado} destinatario(s) reenfileirado(s)).`;
    }

    return res.status(200).json({
      id,
      status: atualizada?.status ?? "em_andamento",
      agendado: modo === "agendar",
      primeiro_agendado_para: primeiroAgendadoPara ?? null,
      total_reiniciados: totalResetados,
      message,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reprocessar-erros", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    const [totalAtualizados] = await CampanhaDestinatarioModel.update(CAMPOS_RESET_REENVIO_DESTINATARIO, {
      where: {
        campanha_id: id,
        status: "erro",
      },
    });
    if (!totalAtualizados) {
      return res.status(200).json({
        id,
        status: campanha.status,
        message: "Nao ha destinatarios com erro para reprocessar.",
      });
    }

    const canalIdReproc = Number(campanha.whatsapp_canal_id);
    if (!Number.isInteger(canalIdReproc) || canalIdReproc <= 0) {
      return res.status(400).json({
        message: "Campanha sem canal WhatsApp definido. Recrie a campanha selecionando um celular.",
      });
    }
    const canalReproc = await WhatsappCanalModel.findOne({
      where: { id: canalIdReproc, candidatoId: req.auth.CandidatoId },
    });
    if (!canalReproc) {
      return res.status(400).json({ message: "Canal WhatsApp da campanha nao encontrado." });
    }
    const wppReproc = whatsappService.getStatusByCanalId(
      canalIdReproc,
      req.auth.CandidatoId,
      canalReproc.nome,
    );
    if (!wppReproc.conectado) {
      return res.status(400).json({
        message: `O celular "${canalReproc.nome}" nao esta conectado. Conecte-o antes de reprocessar.`,
      });
    }

    const conflitoCanalReproc = await campanhaEmAndamentoNoMesmoCanal(
      req.auth.CandidatoId,
      canalIdReproc,
      id,
    );
    if (conflitoCanalReproc) {
      return res.status(409).json({
        message: mensagemConflitoCanalEmAndamento(conflitoCanalReproc, canalReproc.nome),
      });
    }

    const { campanha: atualizada, totalEnfileirado } = await prepararEEnfileirarCampanha(id);
    return res.status(200).json({
      id,
      status: atualizada?.status ?? "finalizada",
      message: `Reprocessamento enfileirado (${totalEnfileirado} destinatario(s)).`,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/cancelar", ...apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }
    if (String(campanha.status) === "finalizada") {
      return res.status(400).json({ message: "Campanha finalizada nao pode ser cancelada." });
    }
    if (String(campanha.status) === "cancelada") {
      return res.status(400).json({ message: "Campanha ja esta cancelada." });
    }

    await sequelize.transaction(async (transaction) => {
      await CampanhaDestinatarioModel.update(
        { status: "cancelado" },
        {
          where: { campanha_id: id, status: "pendente" },
          transaction,
        },
      );
      await campanha.update({ status: "cancelada" }, { transaction });
    });
    await campanha.reload();
    const totalJobsRemovidos = await removerJobsPendentesDaCampanha(id);

    return res.status(200).json({
      id,
      status: campanha.status,
      message: `Campanha cancelada com sucesso. ${totalJobsRemovidos} job(s) pendente(s) removido(s) da fila.`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
