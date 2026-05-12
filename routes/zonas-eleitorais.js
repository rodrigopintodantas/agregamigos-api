"use strict";

const express = require("express");
const { ZonaEleitoralModel } = require("../models");
const { authorize } = require("../auth/authorize");

const router = express.Router();
const apenasAdmin = authorize(["Administrador"]);

router.get("/", apenasAdmin, async (req, res, next) => {
  try {
    const rows = await ZonaEleitoralModel.findAll({
      order: [["nrZona", "ASC"]],
    });
    const out = rows.map((r) => {
      const j = r.get({ plain: true });
      return {
        id: j.id,
        nr_zona: j.nrZona,
        nm_zona: j.nmZona,
      };
    });
    return res.json(out);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
