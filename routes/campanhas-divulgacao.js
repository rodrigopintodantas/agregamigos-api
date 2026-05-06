const express = require("express");
const {
  sequelize,
  CampanhaDivulgacaoModel,
  CampanhaDestinatarioModel,
  PessoaModel,
  ModeloMensagemModel,
} = require("../models");
const { authorize } = require("../auth/authorize");

const router = express.Router();
const apenasAdmin = authorize(["Administrador"]);

function limparNumeros(value) {
  return value != null ? String(value).replace(/\D/g, "") : "";
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
        { model: PessoaModel, attributes: ["id", "nome", "whatsapp"] },
        { model: ModeloMensagemModel, attributes: ["id", "titulo"] },
      ],
      order: [["ordem", "ASC"]],
    });

    return res.json({
      id: campanha.id,
      nome: campanha.nome,
      status: campanha.status,
      total_destinatarios: campanha.total_destinatarios,
      total_enviados: campanha.total_enviados,
      createdAt: campanha.createdAt,
      updatedAt: campanha.updatedAt,
      destinatarios: itens.map((item) => ({
        id: item.id,
        ordem: item.ordem,
        status: item.status,
        tentativas: item.tentativas,
        enviado_em: item.enviado_em,
        erro_ultimo: item.erro_ultimo,
        pessoa: item.PessoaModel
          ? {
              id: item.PessoaModel.id,
              nome: item.PessoaModel.nome,
              whatsapp: item.PessoaModel.whatsapp,
            }
          : null,
        modelo: item.ModeloMensagemModel
          ? {
              id: item.ModeloMensagemModel.id,
              titulo: item.ModeloMensagemModel.titulo,
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
      total_destinatarios: created.total_destinatarios,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
