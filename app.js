const express = require("express");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");

const indexRouter = require("./routes/index");
const errorHandler = require("./middlewares/error-handler");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: "GET,HEAD,PUT,POST,DELETE,PATCH",
    allowedHeaders: ["Content-Type", "Authorization", "up"],
    exposedHeaders: ["Authorization"],
  }),
);
app.use(logger("dev"));
const jsonParserPadrao = express.json({ limit: "5mb" });
const jsonParserOuvidoriaImport = express.json({ limit: "200mb" });
app.use((req, res, next) => {
  const pathOnly = (req.originalUrl ?? "").split("?")[0];
  if (req.method === "POST" && pathOnly.endsWith("/ouvidoria/importar-csv")) {
    return jsonParserOuvidoriaImport(req, res, next);
  }
  return jsonParserPadrao(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(cookieParser());

app.use("/api", indexRouter);
app.use(errorHandler);

module.exports = app;
