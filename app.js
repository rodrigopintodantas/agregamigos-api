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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", indexRouter);
app.use(errorHandler);

module.exports = app;
