// whatsapp/evolution.js — adapter da Evolution API (v2). TODAS as chamadas usam a credencial da
// própria org (`conn.base_url` + `conn.api_key`) — bring-your-own, isolado por organização.
// Os caminhos seguem a Evolution v2; podem precisar de ajuste fino à versão do servidor da org.

async function call(conn, method, path, body) {
  if (!conn.base_url || !conn.api_key) { const e = new Error('Credenciais Evolution da organização ausentes'); e.status = 400; throw e; }
  const url = conn.base_url.replace(/\/+$/, '') + path;
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: conn.api_key },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000), // não pendurar o app se a Evolution da org não responder
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((data && (data.message || data.error)) || `Evolution HTTP ${r.status}`); e.status = 502; e.detalhe = data; throw e; }
  return data;
}

// Cria a instância da org com QR e configura o webhook (apontando p/ a nossa URL + token da instância).
async function createInstance(conn, { webhookUrl }) {
  return call(conn, 'POST', '/instance/create', {
    instanceName: conn.instance_ref,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: { url: webhookUrl, byEvents: false, base64: true, events: ['MESSAGES_UPSERT'] },
  });
}

async function getQrCode(conn) {
  const data = await call(conn, 'GET', `/instance/connect/${encodeURIComponent(conn.instance_ref)}`);
  const qr = data.base64 || (data.qrcode && data.qrcode.base64) || null;
  const pairingCode = data.pairingCode || (data.qrcode && data.qrcode.pairingCode) || null;
  return { qr, pairingCode };
}

async function getConnectionState(conn) {
  try {
    const data = await call(conn, 'GET', `/instance/connectionState/${encodeURIComponent(conn.instance_ref)}`);
    const s = (data.instance && data.instance.state) || data.state;
    return s === 'open' ? 'conectado' : s === 'connecting' ? 'conectando' : 'desconectado';
  } catch (_) { return 'desconectado'; }
}

async function sendMessage(conn, to, text) {
  const number = String(to).replace(/\D/g, '');
  const data = await call(conn, 'POST', `/message/sendText/${encodeURIComponent(conn.instance_ref)}`, { number, text });
  return { provider_msg_id: (data.key && data.key.id) || data.id || null };
}

async function logout(conn) {
  try { await call(conn, 'DELETE', `/instance/logout/${encodeURIComponent(conn.instance_ref)}`); } catch (_) { /* idempotente */ }
  try { await call(conn, 'DELETE', `/instance/delete/${encodeURIComponent(conn.instance_ref)}`); } catch (_) { /* idempotente */ }
}

// Normaliza um payload MESSAGES_UPSERT da Evolution → forma única (ou null se irrelevante).
function parseInbound(payload) {
  const d = (payload && payload.data) || {};
  const key = d.key || {};
  if (!key.id) return null;
  const jid = key.remoteJid || '';
  if (jid.endsWith('@g.us')) return null; // ignora grupos
  const numero = jid.replace(/@.*$/, '').replace(/\D/g, '');
  const m = d.message || {};
  const conteudo = m.conversation
    || (m.extendedTextMessage && m.extendedTextMessage.text)
    || (m.imageMessage && m.imageMessage.caption)
    || '';
  return {
    provider_msg_id: key.id,
    direcao: key.fromMe ? 'saida' : 'entrada',
    remetente: key.fromMe ? null : numero,
    destinatario: key.fromMe ? numero : null,
    conteudo,
    metadata: { pushName: d.pushName || null, timestamp: d.messageTimestamp || null },
    instance: payload.instance,
  };
}

module.exports = { createInstance, getQrCode, getConnectionState, sendMessage, logout, parseInbound };
