const express = require("express");
const { authorize, authBearerCandidatoObrigatorio } = require("../auth/authorize");
const { WhatsappCanalModel } = require("../models");
const whatsappService = require("../services/whatsapp-baileys");

const router = express.Router();
const apenasAdmin = [authBearerCandidatoObrigatorio(), authorize(["Administrador"])];
const internalApiKey = process.env.INTERNAL_API_KEY || "dev-local-key";

function validarChaveInterna(req, res, next) {
  const key = String(req.headers["x-internal-api-key"] || "");
  if (!internalApiKey || key !== internalApiKey) {
    return res.status(401).json({ message: "Nao autorizado para envio interno." });
  }
  return next();
}

function parseCanalIdParam(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

async function buscarCanalDoCandidato(candidatoId, canalId) {
  return WhatsappCanalModel.findOne({
    where: { id: canalId, candidatoId },
  });
}

function mesclarStatusCanal(row, runtime) {
  const base = {
    id: row.id,
    nome: row.nome,
    numero: row.numero,
    status: row.status,
    candidato_id: row.candidatoId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (!runtime) return { ...base, conectado: base.status === "conectado", qrCode: null, nomePerfil: row.nome };
  return {
    ...base,
    conectado: Boolean(runtime.conectado),
    status: runtime.status || base.status,
    numero: runtime.conectado ? runtime.numero || base.numero : base.numero,
    qrCode: runtime.qrCode ?? null,
    nomePerfil: runtime.nomePerfil || row.nome,
    ultimaAtualizacao: runtime.ultimaAtualizacao,
  };
}

router.get("/canais", ...apenasAdmin, async (req, res, next) => {
  try {
    const candidatoId = req.auth.CandidatoId;
    const rows = await WhatsappCanalModel.findAll({
      where: { candidatoId },
      order: [
        ["nome", "ASC"],
        ["id", "ASC"],
      ],
    });
    const canais = rows.map((row) => {
      let runtime = null;
      try {
        runtime = whatsappService.getStatusByCanalId(row.id, candidatoId, row.nome);
      } catch {
        runtime = null;
      }
      return mesclarStatusCanal(row, runtime);
    });
    return res.status(200).json(canais);
  } catch (err) {
    return next(err);
  }
});

router.post("/canais", ...apenasAdmin, async (req, res, next) => {
  try {
    const nome = String(req.body?.nome || "").trim();
    if (!nome) {
      return res.status(400).json({ message: "Informe um nome para o canal." });
    }
    const row = await WhatsappCanalModel.create({
      candidatoId: req.auth.CandidatoId,
      nome,
      numero: null,
      status: "desconectado",
    });
    return res.status(201).json({
      ...mesclarStatusCanal(row, null),
      message: "Canal criado. Conecte-o para vincular um telefone.",
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/canais/:id/status", ...apenasAdmin, async (req, res, next) => {
  try {
    const canalId = parseCanalIdParam(req.params.id);
    if (!canalId) return res.status(400).json({ message: "ID do canal invalido." });

    const row = await buscarCanalDoCandidato(req.auth.CandidatoId, canalId);
    if (!row) return res.status(404).json({ message: "Canal nao encontrado." });

    let runtime = null;
    try {
      runtime = whatsappService.getStatusByCanalId(row.id, row.candidatoId, row.nome);
    } catch {
      runtime = null;
    }
    return res.status(200).json(mesclarStatusCanal(row, runtime));
  } catch (err) {
    return next(err);
  }
});

router.post("/canais/:id/conectar", ...apenasAdmin, async (req, res, next) => {
  try {
    const canalId = parseCanalIdParam(req.params.id);
    if (!canalId) return res.status(400).json({ message: "ID do canal invalido." });

    const row = await buscarCanalDoCandidato(req.auth.CandidatoId, canalId);
    if (!row) return res.status(404).json({ message: "Canal nao encontrado." });

    const nomePerfil = String(req.body?.nomePerfil || row.nome).trim() || row.nome;
    const atual = await whatsappService.connect(row.id, row.candidatoId, nomePerfil, row.nome);
    return res.status(200).json({
      ...mesclarStatusCanal(row, atual),
      message:
        atual.status === "aguardando_qr"
          ? "Escaneie o QR Code para concluir a conexao."
          : "Conexao iniciada com sucesso.",
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/canais/:id/desconectar", ...apenasAdmin, async (req, res, next) => {
  try {
    const canalId = parseCanalIdParam(req.params.id);
    if (!canalId) return res.status(400).json({ message: "ID do canal invalido." });

    const row = await buscarCanalDoCandidato(req.auth.CandidatoId, canalId);
    if (!row) return res.status(404).json({ message: "Canal nao encontrado." });

    const atual = await whatsappService.disconnect(row.id, row.candidatoId, row.nome);
    return res.status(200).json({
      ...mesclarStatusCanal(row, atual),
      message: "Canal WhatsApp desconectado.",
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/canais/:id/trocar-telefone", ...apenasAdmin, async (req, res, next) => {
  try {
    const canalId = parseCanalIdParam(req.params.id);
    if (!canalId) return res.status(400).json({ message: "ID do canal invalido." });

    const row = await buscarCanalDoCandidato(req.auth.CandidatoId, canalId);
    if (!row) return res.status(404).json({ message: "Canal nao encontrado." });

    const nomePerfil = String(req.body?.nomePerfil || row.nome).trim() || row.nome;
    const atual = await whatsappService.trocarTelefone(row.id, row.candidatoId, nomePerfil, row.nome);
    return res.status(200).json({
      ...mesclarStatusCanal(row, atual),
      message:
        atual.status === "aguardando_qr"
          ? "Sessao encerrada. Escaneie o QR Code com o novo telefone."
          : "Troca de telefone iniciada. Siga as instrucoes na tela para concluir.",
    });
  } catch (err) {
    return next(err);
  }
});

/** Compatibilidade: status do canal Principal (ou primeiro canal). */
router.get("/status", ...apenasAdmin, async (req, res, next) => {
  try {
    const row =
      (await WhatsappCanalModel.findOne({
        where: { candidatoId: req.auth.CandidatoId, nome: "Principal" },
      })) ||
      (await WhatsappCanalModel.findOne({
        where: { candidatoId: req.auth.CandidatoId },
        order: [["id", "ASC"]],
      }));
    if (!row) {
      return res.status(404).json({ message: "Nenhum canal WhatsApp cadastrado." });
    }
    let runtime = null;
    try {
      runtime = whatsappService.getStatusByCanalId(row.id, row.candidatoId, row.nome);
    } catch {
      runtime = null;
    }
    return res.status(200).json(mesclarStatusCanal(row, runtime));
  } catch (err) {
    return next(err);
  }
});

async function canalPadraoCandidato(candidatoId, canalIdOpcional) {
  if (canalIdOpcional) {
    return buscarCanalDoCandidato(candidatoId, canalIdOpcional);
  }
  return (
    (await WhatsappCanalModel.findOne({
      where: { candidatoId, nome: "Principal" },
    })) ||
    (await WhatsappCanalModel.findOne({
      where: { candidatoId },
      order: [["id", "ASC"]],
    }))
  );
}

router.post("/conectar", ...apenasAdmin, async (req, res, next) => {
  try {
    const row = await canalPadraoCandidato(
      req.auth.CandidatoId,
      parseCanalIdParam(req.body?.whatsapp_canal_id),
    );
    if (!row) return res.status(404).json({ message: "Nenhum canal WhatsApp cadastrado." });
    const nomePerfil = String(req.body?.nomePerfil || row.nome).trim() || row.nome;
    const atual = await whatsappService.connect(row.id, row.candidatoId, nomePerfil, row.nome);
    return res.status(200).json({
      ...mesclarStatusCanal(row, atual),
      message:
        atual.status === "aguardando_qr"
          ? "Escaneie o QR Code para concluir a conexao."
          : "Conexao iniciada com sucesso.",
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/desconectar", ...apenasAdmin, async (req, res, next) => {
  try {
    const row = await canalPadraoCandidato(
      req.auth.CandidatoId,
      parseCanalIdParam(req.body?.whatsapp_canal_id),
    );
    if (!row) return res.status(404).json({ message: "Canal nao encontrado." });
    const atual = await whatsappService.disconnect(row.id, row.candidatoId, row.nome);
    return res.status(200).json({
      ...mesclarStatusCanal(row, atual),
      message: "Canal WhatsApp desconectado.",
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/trocar-telefone", ...apenasAdmin, async (req, res, next) => {
  try {
    const row = await canalPadraoCandidato(
      req.auth.CandidatoId,
      parseCanalIdParam(req.body?.whatsapp_canal_id),
    );
    if (!row) return res.status(404).json({ message: "Canal nao encontrado." });
    const nomePerfil = String(req.body?.nomePerfil || row.nome).trim() || row.nome;
    const atual = await whatsappService.trocarTelefone(row.id, row.candidatoId, nomePerfil, row.nome);
    return res.status(200).json({
      ...mesclarStatusCanal(row, atual),
      message:
        atual.status === "aguardando_qr"
          ? "Sessao encerrada. Escaneie o QR Code com o novo telefone."
          : "Troca de telefone iniciada. Siga as instrucoes na tela para concluir.",
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/send-interno", validarChaveInterna, async (req, res, next) => {
  try {
    const numero = String(req.body?.numero || "");
    const mensagem = String(req.body?.mensagem || "");
    const candidatoId = Number(req.body?.candidato_id);
    const canalId = Number(req.body?.whatsapp_canal_id);
    if (!Number.isInteger(candidatoId) || candidatoId <= 0) {
      return res.status(400).json({ message: "Informe candidato_id valido no corpo da requisicao." });
    }
    if (!Number.isInteger(canalId) || canalId <= 0) {
      return res.status(400).json({ message: "Informe whatsapp_canal_id valido no corpo da requisicao." });
    }

    const canal = await WhatsappCanalModel.findOne({
      where: { id: canalId, candidatoId },
    });
    if (!canal) {
      return res.status(400).json({ message: "Canal WhatsApp nao encontrado para este candidato." });
    }

    const envio = await whatsappService.sendText(
      canal.id,
      canal.candidatoId,
      numero,
      mensagem,
      canal.nome,
    );
    return res.status(200).json({
      message: "Mensagem enviada.",
      whatsapp_canal_id: canal.id,
      numero_normalizado: envio?.numeroNormalizado || null,
      whatsapp_match: envio?.whatsappMatch || null,
      jid_digitado: envio?.jidDigitado || null,
      jid_resolvido: envio?.jidResolvido || null,
      message_id: envio?.messageId || null,
      remote_jid: envio?.remoteJid || null,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
