"use strict";

const { Op } = require("sequelize");
const { sequelize, CampanhaDestinatarioModel } = require("../models");
const { classificarSentimento } = require("./campanha-resposta-sentimento");
const { atualizarEngajamentoPessoaDeRespostas } = require("./pessoa-engajamento-whatsapp");

const MS_48H = 48 * 60 * 60 * 1000;
const TEXTO_MAX = 4000;

function debugCaptura(...args) {
  if (String(process.env.CAPTURA_RESPOSTAS_DEBUG || "").trim() === "1") {
    console.log("[captura-respostas]", ...args);
  }
}

function obterJanelaMs() {
  const raw = Number(process.env.CAMPANHA_RESPOSTA_JANELA_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return MS_48H;
}

function jidParaDigitos(jid) {
  const user = String(jid || "").split("@")[0] || "";
  return user.replace(/\D/g, "");
}

/** IDs do WA podem vir como string ou Buffer (protobuf). */
function waIdParaString(id) {
  if (id == null || id === "") return "";
  if (typeof id === "string") return id;
  if (Buffer.isBuffer(id)) {
    const utf8 = id.toString("utf8");
    if (utf8 && /^[\x09\x0A\x0D\x20-\x7E]+$/.test(utf8)) return utf8;
    return id.toString("latin1");
  }
  if (typeof id === "object" && id.type === "Buffer" && Array.isArray(id.data)) {
    return waIdParaString(Buffer.from(id.data));
  }
  return String(id);
}

/**
 * Gera variantes do número para bater com `campanha_destinatario.whatsapp`
 * (cadastro pode estar sem DDI 55; o JID costuma vir com 55).
 * require do Baileys é lazy para evitar dependência circular na carga do módulo.
 */
function coletarVariantesWhatsappParaBusca(msg) {
  const set = new Set();
  const jids = [msg.key?.remoteJid, msg.key?.remoteJidAlt].filter(Boolean).map(String);

  for (const jid of jids) {
    if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us")) continue;
    const d = jidParaDigitos(jid);
    if (!d || d.length < 8) continue;
    set.add(d);
    try {
      const whatsappService = require("./whatsapp-baileys");
      const n = whatsappService.normalizarNumeroBrasil(d);
      if (n) set.add(String(n).replace(/\D/g, ""));
    } catch (_e) {
      /* serviço ainda não inicializado */
    }
    if (d.startsWith("55") && d.length >= 12) set.add(d.slice(2));
    if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) set.add(`55${d}`);
  }

  return [...set].slice(0, 12);
}

function desembrulharMessage(msg) {
  let m = msg;
  for (let i = 0; i < 6 && m; i += 1) {
    if (m.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message;
      continue;
    }
    if (m.viewOnceMessageV2?.message) {
      m = m.viewOnceMessageV2.message;
      continue;
    }
    if (m.viewOnceMessage?.message) {
      m = m.viewOnceMessage.message;
      continue;
    }
    if (m.documentWithCaptionMessage?.message) {
      m = m.documentWithCaptionMessage.message;
      continue;
    }
    break;
  }
  return m;
}

function extrairContextInfo(message) {
  const m = desembrulharMessage(message);
  if (!m || typeof m !== "object") return null;
  if (m.extendedTextMessage?.contextInfo) return m.extendedTextMessage.contextInfo;
  if (m.imageMessage?.contextInfo) return m.imageMessage.contextInfo;
  if (m.videoMessage?.contextInfo) return m.videoMessage.contextInfo;
  if (m.audioMessage?.contextInfo) return m.audioMessage.contextInfo;
  if (m.documentMessage?.contextInfo) return m.documentMessage.contextInfo;
  if (m.buttonsResponseMessage?.contextInfo) return m.buttonsResponseMessage.contextInfo;
  return null;
}

function extrairTextoInbound(message) {
  const m = desembrulharMessage(message);
  if (!m || typeof m !== "object") return "";
  if (m.conversation) return String(m.conversation);
  if (m.extendedTextMessage?.text) return String(m.extendedTextMessage.text);
  if (m.imageMessage?.caption) return String(m.imageMessage.caption);
  if (m.videoMessage?.caption) return String(m.videoMessage.caption);
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return String(m.buttonsResponseMessage.selectedDisplayText);
  }
  if (m.listResponseMessage?.title || m.listResponseMessage?.description) {
    return [m.listResponseMessage.title, m.listResponseMessage.description].filter(Boolean).join(" ");
  }
  return "";
}

function extrairStanzaIdCitado(message) {
  const ctx = extrairContextInfo(message);
  const id = ctx?.stanzaId;
  return id ? waIdParaString(id) : null;
}

function timestampRecebimento(msg) {
  const ts = Number(msg.messageTimestamp);
  if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000);
  return new Date();
}

function limparTexto(texto) {
  return String(texto || "")
    .trim()
    .slice(0, TEXTO_MAX);
}

async function buscarDestinatarioPorCitacao(quotedId, recvAt) {
  const qid = waIdParaString(quotedId);
  if (!qid) return null;
  const janelaMs = obterJanelaMs();
  const limiteInferior = new Date(recvAt.getTime() - janelaMs);
  return CampanhaDestinatarioModel.findOne({
    where: {
      status: "enviado",
      wa_message_id_envio: qid,
      enviado_em: { [Op.lte]: recvAt, [Op.gte]: limiteInferior },
    },
    order: [["enviado_em", "DESC"]],
  });
}

async function buscarDestinatarioPorJanela(variantesDigitos, recvAt) {
  const janelaMs = obterJanelaMs();
  const limiteInferior = new Date(recvAt.getTime() - janelaMs);
  const lista = Array.isArray(variantesDigitos) ? variantesDigitos.filter(Boolean) : [];
  if (!lista.length) return null;

  const candidatos = await CampanhaDestinatarioModel.findAll({
    where: {
      status: "enviado",
      whatsapp: { [Op.in]: lista },
      enviado_em: { [Op.lte]: recvAt, [Op.gte]: limiteInferior },
    },
    order: [["enviado_em", "DESC"]],
    limit: 24,
  });

  for (const row of candidatos) {
    const r1 = row.resposta_1_wa_id;
    const r2 = row.resposta_2_wa_id;
    if (!r1 || !r2) return row;
  }
  return null;
}

async function gravarRespostaSeAplicavel(destinatario, waMsgId, texto, recvAt) {
  if (!destinatario?.id) return;
  const t = limparTexto(texto);
  const sentimento = classificarSentimento(t);

  await sequelize.transaction(async (transaction) => {
    const row = await CampanhaDestinatarioModel.findOne({
      where: { id: destinatario.id },
      transaction,
      lock: true,
    });
    if (!row || String(row.status) !== "enviado") return;

    const wa = waIdParaString(waMsgId);
    if (!wa) return;

    if (row.resposta_1_wa_id === wa || row.resposta_2_wa_id === wa) return;

    const enviadoEm = row.enviado_em ? new Date(row.enviado_em) : null;
    if (!enviadoEm || Number.isNaN(enviadoEm.getTime())) return;

    const janelaMs = obterJanelaMs();
    if (recvAt.getTime() < enviadoEm.getTime()) return;
    if (recvAt.getTime() > enviadoEm.getTime() + janelaMs) return;

    if (!row.resposta_1_wa_id) {
      await row.update(
        {
          resposta_1_texto: t || null,
          resposta_1_em: recvAt,
          resposta_1_wa_id: wa,
          resposta_1_sentimento: sentimento,
        },
        { transaction },
      );
      await row.reload({ transaction });
      await atualizarEngajamentoPessoaDeRespostas(
        row.pessoa_id,
        row.resposta_1_sentimento,
        row.resposta_2_sentimento,
        { transaction },
      );
      return;
    }
    if (!row.resposta_2_wa_id) {
      await row.update(
        {
          resposta_2_texto: t || null,
          resposta_2_em: recvAt,
          resposta_2_wa_id: wa,
          resposta_2_sentimento: sentimento,
        },
        { transaction },
      );
      await row.reload({ transaction });
      await atualizarEngajamentoPessoaDeRespostas(
        row.pessoa_id,
        row.resposta_1_sentimento,
        row.resposta_2_sentimento,
        { transaction },
      );
    }
  });
}

async function processarMensagemInbound(msg, upsertType) {
  try {
    if (!msg?.key) return;
    if (msg.key.fromMe) return;

    const remote = msg.key.remoteJid ? String(msg.key.remoteJid) : "";
    if (!remote || remote === "status@broadcast" || remote.endsWith("@g.us")) return;

    const variantes = coletarVariantesWhatsappParaBusca(msg);
    if (!variantes.length) return;

    const texto = extrairTextoInbound(msg.message);
    const waId = waIdParaString(msg.key.id);
    const recvAt = timestampRecebimento(msg);
    const quotedId = extrairStanzaIdCitado(msg.message);

    if (!String(texto || "").trim() && !quotedId) return;

    debugCaptura("inbound", {
      upsertType,
      remote,
      variantes,
      waId,
      quotedId,
      textoPreview: (texto || "").slice(0, 40),
    });

    let destinatario = null;
    if (quotedId) {
      destinatario = await buscarDestinatarioPorCitacao(quotedId, recvAt);
    }
    if (!destinatario) {
      destinatario = await buscarDestinatarioPorJanela(variantes, recvAt);
    }
    if (!destinatario) {
      debugCaptura("sem destinatario", { variantes, quotedId });
      return;
    }

    await gravarRespostaSeAplicavel(destinatario, waId, texto, recvAt);
  } catch (err) {
    console.error("[captura-respostas] Erro ao processar mensagem:", err?.message || err);
  }
}

function anexarCapturaRespostas(socket) {
  if (!socket?.ev) return;

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    // `notify` = mensagem em tempo real; `append` = fila/offline/histórico — respostas do usuário costumam chegar nas duas.
    if ((type !== "notify" && type !== "append") || !Array.isArray(messages)) return;
    for (const msg of messages) {
      await processarMensagemInbound(msg, type);
    }
  });
}

module.exports = { anexarCapturaRespostas };
