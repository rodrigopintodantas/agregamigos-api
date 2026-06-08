const crypto = require("crypto");
const express = require("express");
const {
  sequelize,
  EventoModel,
  EventoPessoaModel,
  PessoaModel,
  EnderecoModel,
  UsuarioCandidatoModel,
  UsuarioModel,
  PapelModel,
  CandidatoModel,
} = require("../models");
const { authorize, authBearerCandidatoObrigatorio } = require("../auth/authorize");
const {
  sincronizarCoordenadoresDoEvento,
} = require("../services/evento-coordenador");
const { BAIRROS_DF_SET } = require("../constants/bairros-distrito-federal");

const router = express.Router();
const apenasAdmin = [authBearerCandidatoObrigatorio(), authorize(["Administrador"])];
const adminOuCoordenador = [
  authBearerCandidatoObrigatorio(),
  authorize(["Administrador", "Coordenador"]),
];

function ehCoordenador(req) {
  return String(req.auth?.PapelNome ?? "") === "Coordenador";
}

const includeCoordenadoresEvento = [
  {
    model: UsuarioModel,
    as: "CoordenadoresModel",
    attributes: ["id", "nome"],
    through: { attributes: [] },
    required: false,
  },
];

function gerarTokenCadastroEvento() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const buf = crypto.randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i += 1) s += chars[buf[i] % chars.length];
  return s;
}

async function gerarTokenCadastroUnico(transaction) {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const candidate = gerarTokenCadastroEvento();
    const existe = await EventoModel.findOne({
      where: { token_cadastro: candidate },
      attributes: ["id"],
      transaction,
    });
    if (!existe) return candidate;
  }
  throw new Error("Nao foi possivel gerar token unico para o evento.");
}

function parseCoordenadorIds(body) {
  const raw = body?.id_coordenadores;
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .map((v) => Number(v))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
  }
  const single = body?.id_coordenador;
  if (single != null && single !== "") {
    const id = Number(single);
    if (Number.isInteger(id) && id > 0) return [id];
  }
  return [];
}

async function validarCoordenadoresCandidato(candidatoId, ids) {
  if (!ids.length) return true;
  for (const id of ids) {
    const ok = await validarCoordenadorCandidato(candidatoId, id);
    if (!ok) return false;
  }
  return true;
}

async function validarCoordenadorCandidato(candidatoId, idCoordenador) {
  const id = Number(idCoordenador);
  if (!Number.isInteger(id) || id <= 0) return false;
  const vinculo = await UsuarioCandidatoModel.findOne({
    where: { candidato_id: candidatoId, usuario_id: id },
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
  return Boolean(vinculo);
}

function deserializarLocais(stored) {
  if (stored == null || stored === "") return [];
  const texto = String(stored).trim();
  if (!texto) return [];
  if (texto.startsWith("[")) {
    try {
      const parsed = JSON.parse(texto);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map((v) => String(v).trim()).filter(Boolean))];
      }
    } catch {
      /* legado: trata como texto simples */
    }
  }
  return [texto];
}

function gravarLocais(locais) {
  if (!locais.length) return null;
  return JSON.stringify(locais);
}

function parseLocaisBody(body) {
  const raw = body?.locais ?? body?.local;
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))];
  }
  if (raw != null && String(raw).trim()) {
    return [String(raw).trim()];
  }
  return [];
}

function serializarCoordenadores(row) {
  const lista = row.CoordenadoresModel ?? [];
  return lista
    .map((u) => ({ id: u.id, nome: u.nome }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt"));
}

function serializarLocaisEvento(row) {
  const locais = deserializarLocais(row.local);
  return {
    locais,
    local: locais.length ? locais.join(", ") : null,
  };
}

function serializarEventoLista(row) {
  const { locais, local } = serializarLocaisEvento(row);
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao ?? null,
    data_evento: row.data_evento ?? null,
    locais,
    local,
    status: row.status,
    total_inscritos: row.total_inscritos ?? 0,
    token_cadastro: row.token_cadastro,
    coordenadores: serializarCoordenadores(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/coordenadores", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const vinculos = await UsuarioCandidatoModel.findAll({
      where: { candidato_id: candidatoId },
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
    return res.json({ coordenadores });
  } catch (err) {
    next(err);
  }
});

router.get("/", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const eventos = await EventoModel.findAll({
      where: { candidatoId: req.auth.CandidatoId },
      include: includeCoordenadoresEvento,
      order: [
        ["data_evento", "DESC NULLS LAST"],
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
    });
    return res.json(eventos.map(serializarEventoLista));
  } catch (err) {
    next(err);
  }
});

router.post("/", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const nome = String(req.body?.nome ?? "").trim();
    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe o nome do evento com pelo menos 3 caracteres." });
    }

    const descricao =
      req.body?.descricao != null && String(req.body.descricao).trim()
        ? String(req.body.descricao).trim()
        : null;
    const locais = parseLocaisBody(req.body);
    const locaisInvalidos = locais.filter((b) => !BAIRROS_DF_SET.has(b));
    if (locaisInvalidos.length) {
      return res.status(400).json({ message: "Um ou mais bairros selecionados sao invalidos." });
    }
    const local = gravarLocais(locais);
    const dataEvento =
      req.body?.data_evento != null && String(req.body.data_evento).trim()
        ? String(req.body.data_evento).trim()
        : null;
    if (dataEvento && !/^\d{4}-\d{2}-\d{2}$/.test(dataEvento)) {
      return res.status(400).json({ message: "Data do evento invalida." });
    }

    let idsCoordenadores = parseCoordenadorIds(req.body);
    if (ehCoordenador(req)) {
      const uid = Number(req.auth.UsuarioId);
      if (Number.isInteger(uid) && uid > 0 && !idsCoordenadores.includes(uid)) {
        idsCoordenadores = [...idsCoordenadores, uid];
      }
    }
    const coordsOk = await validarCoordenadoresCandidato(candidatoId, idsCoordenadores);
    if (!coordsOk) {
      return res.status(400).json({ message: "Um ou mais coordenadores sao invalidos para este candidato." });
    }

    const created = await sequelize.transaction(async (transaction) => {
      const token_cadastro = await gerarTokenCadastroUnico(transaction);
      const evento = await EventoModel.create(
        {
          candidatoId,
          nome,
          descricao,
          data_evento: dataEvento,
          local,
          token_cadastro,
          status: "ativo",
          total_inscritos: 0,
        },
        { transaction },
      );
      await sincronizarCoordenadoresDoEvento(evento.id, idsCoordenadores, transaction);
      return evento;
    });

    const completo = await EventoModel.findByPk(created.id, {
      include: includeCoordenadoresEvento,
    });

    return res.status(201).json({
      message: "Evento criado com sucesso.",
      evento: serializarEventoLista(completo),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const evento = await EventoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
      include: [
        ...includeCoordenadoresEvento,
        {
          model: CandidatoModel,
          attributes: ["id", "nome", "slug"],
          required: true,
        },
      ],
    });
    if (!evento) {
      return res.status(404).json({ message: "Evento nao encontrado." });
    }

    const inscricoes = await EventoPessoaModel.findAll({
      where: { evento_id: id },
      include: [
        {
          model: PessoaModel,
          required: true,
          attributes: ["id", "nome", "whatsapp", "email", "createdAt", "idCoordenador"],
          include: [
            { model: EnderecoModel, required: false, attributes: ["bairro", "cidade"] },
            {
              model: UsuarioModel,
              required: false,
              attributes: ["id", "nome"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const candidatoSlug = evento.CandidatoModel?.slug ?? "";
    const linkPath = candidatoSlug
      ? `/${candidatoSlug}/link-cadastro?evento=${encodeURIComponent(evento.token_cadastro)}`
      : null;

    return res.json({
      ...serializarEventoLista(evento),
      candidato_slug: candidatoSlug,
      link_cadastro_path: linkPath,
      inscritos: inscricoes.map((row) => {
        const p = row.PessoaModel;
        const end = p?.EnderecoModel;
        const coord = p.UsuarioModel;
        return {
          id: p.id,
          nome: p.nome,
          whatsapp: p.whatsapp ?? null,
          email: p.email ?? null,
          bairro: end?.bairro ?? null,
          cidade: end?.cidade ?? null,
          coordenador_id: coord?.id ?? p.idCoordenador ?? null,
          coordenador_nome: coord?.nome ?? null,
          inscrito_em: row.createdAt,
          pessoa_cadastrada_em: p.createdAt,
        };
      }),
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

    const evento = await EventoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!evento) {
      return res.status(404).json({ message: "Evento nao encontrado." });
    }

    await evento.destroy();
    return res.json({ message: "Evento excluido com sucesso." });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/status", ...adminOuCoordenador, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status ?? "").trim().toLowerCase();
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }
    if (!["ativo", "encerrado"].includes(status)) {
      return res.status(400).json({ message: "Status invalido. Use: ativo ou encerrado." });
    }

    const evento = await EventoModel.findOne({
      where: { id, candidatoId: req.auth.CandidatoId },
    });
    if (!evento) {
      return res.status(404).json({ message: "Evento nao encontrado." });
    }

    await evento.update({ status });
    return res.json({
      message: status === "encerrado" ? "Evento encerrado." : "Evento reativado.",
      status: evento.status,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
