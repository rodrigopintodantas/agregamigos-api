"use strict";

/**
 * Inicia a API (bin/www) e o worker BullMQ (campanha-envio) no mesmo processo pai.
 * Usado por `npm start` em desenvolvimento local; em Docker use o serviço `worker-campanha`.
 */

const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const node = process.execPath;

const childOpts = {
  cwd: root,
  env: process.env,
  stdio: "inherit",
};

const api = spawn(node, [path.join(root, "bin", "www")], childOpts);
const worker = spawn(node, [path.join(root, "workers", "campanha-envio-worker.js")], childOpts);

const children = [api, worker];

let shuttingDown = false;
let exitScheduled = false;

function killAll(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode === null && c.signalCode == null) {
      try {
        c.kill(signal);
      } catch {
        /* ignore */
      }
    }
  }
}

process.on("SIGINT", () => killAll("SIGINT"));
process.on("SIGTERM", () => killAll("SIGTERM"));

function mapExitCode(code, signal) {
  if (signal === "SIGINT" || signal === "SIGTERM") return 0;
  if (code === 0 || code === null) return 0;
  return Number(code) || 1;
}

function onChildExit(label, code, signal) {
  if (exitScheduled) return;
  exitScheduled = true;
  if (!shuttingDown) {
    console.error(
      `[run-api-and-worker] processo "${label}" terminou (code=${code} signal=${signal}). Encerrando o outro.`,
    );
  }
  killAll("SIGTERM");
  const exitCode = mapExitCode(code, signal);
  setTimeout(() => process.exit(exitCode), 150);
}

api.on("exit", (code, signal) => onChildExit("api", code, signal));
worker.on("exit", (code, signal) => onChildExit("worker", code, signal));
