const express = require("express");

const router = express.Router();

router.get("/status", (req, res) => {
  res.status(200).json({
    msg: "Estou bem - agregamigos-api",
    timestamp: new Date().toISOString(),
  });
});

router.get("/", (req, res) => {
  res.status(200).json({ msg: "agregamigos-api" });
});

router.use("/auth", require("./auth"));
router.use("/pessoas", require("./pessoas"));
router.use("/modelos-mensagem", require("./modelos-mensagem"));
router.use("/usuarios", require("./usuarios"));

module.exports = router;
