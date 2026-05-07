const express = require("express");
const {
  sequelize,
  CampanhaDivulgacaoModel,
  CampanhaDestinatarioModel,
  PessoaModel,
  EnderecoModel,
  UsuarioModel,
  ModeloMensagemModel,
} = require("../models");
const { authorize } = require("../auth/authorize");
const whatsappService = require("../services/whatsapp-baileys");
const {
  enfileirarDestinatarios,
  validarFilaDisponivel,
  removerJobsPendentesDaCampanha,
} = require("../queues/campanha-envio-queue");

const router = express.Router();
const apenasAdmin = authorize(["Administrador"]);

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

function turnoPorHora(date) {
  const hora = date.getHours();
  if (hora < 12) return "manha";
  if (hora < 18) return "tarde";
  return "noite";
}

function baseTurno(diaBase, turno) {
  const d = new Date(diaBase);
  d.setSeconds(0, 0);
  if (turno === "manha") {
    d.setHours(8, 0, 0, 0);
    return d;
  }
  if (turno === "tarde") {
    d.setHours(13, 0, 0, 0);
    return d;
  }
  d.setHours(19, 0, 0, 0);
  return d;
}

function janelaTurno(turno) {
  if (turno === "manha") return { min: 0, max: 239 }; // 08:00-11:59
  if (turno === "tarde") return { min: 0, max: 299 }; // 13:00-17:59
  return { min: 0, max: 179 }; // 19:00-21:59
}

function mesmoDia(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function gerarAgendamentoPorDisparo(index, mensagensPorTurno, disparoEm, usedKeys) {
  const baseInicial = new Date(disparoEm);
  const primeiroEnvio = new Date(baseInicial.getTime() + 60 * 1000);

  if (index === 0) {
    usedKeys.add(primeiroEnvio.toISOString());
    return {
      turno: turnoPorHora(primeiroEnvio),
      agendadoPara: primeiroEnvio,
    };
  }

  const porTurno = Math.max(1, mensagensPorTurno);
  const turnoInicial = turnoPorHora(primeiroEnvio);
  const bloco = Math.floor(index / porTurno);
  const turno = TURNOS[(indiceTurno(turnoInicial) + bloco) % TURNOS.length];
  const ciclosCompletos = Math.floor((indiceTurno(turnoInicial) + bloco) / TURNOS.length);
  const faixa = janelaTurno(turno);

  let offsetDia = ciclosCompletos;
  let candidate = null;
  while (!candidate) {
    const diaAlvo = new Date(primeiroEnvio);
    diaAlvo.setDate(primeiroEnvio.getDate() + offsetDia);
    const base = baseTurno(diaAlvo, turno);

    let minFaixa = faixa.min;
    if (mesmoDia(base, primeiroEnvio)) {
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

async function prepararEEnfileirarCampanha(campanhaId) {
  const campanha = await CampanhaDivulgacaoModel.findByPk(campanhaId);
  if (!campanha) return null;

  const pendentes = await CampanhaDestinatarioModel.findAll({
    where: { campanha_id: campanhaId, status: "pendente" },
    order: [["ordem", "ASC"]],
  });

  if (!pendentes.length) {
    await campanha.update({ status: "finalizada" });
    await campanha.reload();
    return { campanha, totalEnfileirado: 0 };
  }

  const usados = new Set();
  const disparoEm = new Date();
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
  return { campanha, totalEnfileirado: pendentes.length };
}

router.get("/", apenasAdmin, async (req, res, next) => {
  try {
    const campanhas = await CampanhaDivulgacaoModel.findAll({
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
        },
      ]),
    );

    return res.json(
      campanhas.map((c) => {
        const agg = map.get(c.id) || { total: 0, enviados: 0, pendentes: 0 };
        return {
          id: c.id,
          nome: c.nome,
          status: c.status,
          mensagens_por_turno: c.mensagens_por_turno ?? 2,
          total_destinatarios: c.total_destinatarios ?? agg.total,
          total_enviados: c.total_enviados ?? agg.enviados,
          total_pendentes: agg.pendentes,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/:id", apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findByPk(id);
    if (!campanha) return res.status(404).json({ message: "Campanha nao encontrada." });

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

    return res.json({
      id: campanha.id,
      nome: campanha.nome,
      status: campanha.status,
      mensagens_por_turno: campanha.mensagens_por_turno ?? 2,
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
        erro_ultimo: item.erro_ultimo,
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

router.post("/", apenasAdmin, async (req, res, next) => {
  try {
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const pessoaIds = Array.isArray(req.body?.pessoa_ids) ? req.body.pessoa_ids.map(Number) : [];
    const modeloIds = Array.isArray(req.body?.modelo_ids) ? req.body.modelo_ids.map(Number) : [];
    const mensagensPorTurnoRaw = Number(req.body?.mensagens_por_turno ?? 2);
    const mensagensPorTurno = Number.isInteger(mensagensPorTurnoRaw)
      ? Math.max(1, Math.min(50, mensagensPorTurnoRaw))
      : 2;

    const pessoaIdsValidos = [...new Set(pessoaIds.filter((id) => Number.isInteger(id) && id > 0))];
    const modeloIdsValidos = [...new Set(modeloIds.filter((id) => Number.isInteger(id) && id > 0))];

    if (!nome) return res.status(400).json({ message: "Informe o nome da campanha." });
    if (!pessoaIdsValidos.length)
      return res.status(400).json({ message: "Selecione pelo menos uma pessoa." });
    if (modeloIdsValidos.length < 2) {
      return res
        .status(400)
        .json({ message: "Selecione obrigatoriamente 2 ou mais modelos diferentes." });
    }

    const pessoas = await PessoaModel.findAll({
      where: { id: pessoaIdsValidos },
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
      where: { id: modeloIdsValidos },
      attributes: ["id", "titulo"],
      order: [["titulo", "ASC"]],
    });
    if (modelos.length !== modeloIdsValidos.length) {
      return res.status(400).json({ message: "Um ou mais modelos selecionados nao foram encontrados." });
    }

    const created = await sequelize.transaction(async (transaction) => {
      const campanha = await CampanhaDivulgacaoModel.create(
        {
          nome,
          status: "montada",
          total_destinatarios: pessoas.length,
          total_enviados: 0,
          mensagens_por_turno: mensagensPorTurno,
          usuario_id: req.auth?.UsuarioId ?? null,
        },
        { transaction },
      );

      const payloadDestinatarios = pessoas.map((pessoa, index) => {
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
      return campanha;
    });

    return res.status(201).json({
      id: created.id,
      message: "Campanha criada com sucesso.",
      status: created.status,
      mensagens_por_turno: created.mensagens_por_turno,
      total_destinatarios: created.total_destinatarios,
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findByPk(id);
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    if (String(campanha.status) !== "montada") {
      return res.status(400).json({
        message: "A campanha so pode ser excluida quando estiver no status Montada.",
      });
    }

    await campanha.destroy();
    return res.status(200).json({ message: "Campanha excluida com sucesso." });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/iniciar", apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findByPk(id);
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    if (String(campanha.status) === "cancelada") {
      return res.status(400).json({ message: "Campanha cancelada nao pode ser iniciada." });
    }
    const wpp = whatsappService.getStatus();
    if (!wpp.conectado) {
      return res.status(400).json({
        message: "Canal WhatsApp desconectado. Conecte o Baileys antes de iniciar a campanha.",
      });
    }

    const { campanha: atualizada, totalEnfileirado } = await prepararEEnfileirarCampanha(id);
    return res.status(200).json({
      id,
      status: atualizada?.status ?? "finalizada",
      message: totalEnfileirado
        ? `Campanha enfileirada com sucesso (${totalEnfileirado} destinatario(s)).`
        : "Campanha sem destinatarios pendentes para envio.",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reprocessar-erros", apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findByPk(id);
    if (!campanha) {
      return res.status(404).json({ message: "Campanha nao encontrada." });
    }

    const [totalAtualizados] = await CampanhaDestinatarioModel.update(
      { status: "pendente", erro_ultimo: null },
      {
        where: {
          campanha_id: id,
          status: "erro",
        },
      },
    );
    if (!totalAtualizados) {
      return res.status(200).json({
        id,
        status: campanha.status,
        message: "Nao ha destinatarios com erro para reprocessar.",
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

router.post("/:id/cancelar", apenasAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const campanha = await CampanhaDivulgacaoModel.findByPk(id);
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
