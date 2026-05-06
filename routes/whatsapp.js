const express = require("express");
const { authorize } = require("../auth/authorize");
const whatsappService = require("../services/whatsapp-baileys");

const router = express.Router();
const apenasAdmin = authorize(["Administrador"]);

router.get("/status", apenasAdmin, (req, res) => {
  res.status(200).json(whatsappService.getStatus());
});

router.post("/conectar", apenasAdmin, async (req, res, next) => {
  const nomePerfil = String(req.body?.nomePerfil || "Canal principal").trim();

  try {
    const atual = await whatsappService.connect(nomePerfil || "Canal principal");
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

router.post("/desconectar", apenasAdmin, async (req, res, next) => {
  try {
    const atual = await whatsappService.disconnect();
    return res.status(200).json({
      ...atual,
      message: "Canal WhatsApp desconectado.",
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
