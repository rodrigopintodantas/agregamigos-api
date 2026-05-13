const express = require("express");
const { authorize, authBearerCandidatoObrigatorio } = require("../auth/authorize");
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

router.get("/status", ...apenasAdmin, (req, res) => {
  res.status(200).json(whatsappService.getStatus(req.auth.CandidatoId));
});

router.post("/conectar", ...apenasAdmin, async (req, res, next) => {
  const nomePerfil = String(req.body?.nomePerfil || "Canal principal").trim();

  try {
    const atual = await whatsappService.connect(req.auth.CandidatoId, nomePerfil || "Canal principal");
    return res.status(200).json({
      ...atual,
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
    const atual = await whatsappService.disconnect(req.auth.CandidatoId);
    return res.status(200).json({
      ...atual,
      message: "Canal WhatsApp desconectado.",
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/trocar-telefone", ...apenasAdmin, async (req, res, next) => {
  const nomePerfil = String(req.body?.nomePerfil || "Canal principal").trim();

  try {
    const atual = await whatsappService.trocarTelefone(
      req.auth.CandidatoId,
      nomePerfil || "Canal principal",
    );
    return res.status(200).json({
      ...atual,
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
    if (!Number.isInteger(candidatoId) || candidatoId <= 0) {
      return res.status(400).json({ message: "Informe candidato_id valido no corpo da requisicao." });
    }
    const envio = await whatsappService.sendText(candidatoId, numero, mensagem);
    return res.status(200).json({
      message: "Mensagem enviada.",
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
