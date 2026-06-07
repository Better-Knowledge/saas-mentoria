// billing/pagarme.js — cliente HTTP do pagar.me (assinaturas) + verificação de webhook.
// As chamadas reais exigem PAGARME_API_KEY (sem ela, lançam 503 claro). O cartão é tokenizado no
// cliente / checkout hospedado — nenhum PAN passa por aqui (Princípio II / FR-007).
const crypto = require('crypto');

const BASE = process.env.PAGARME_URL || 'https://api.pagar.me/core/v5';

function configurado() { return !!process.env.PAGARME_API_KEY; }

function authHeader() {
  // pagar.me v5: a secret key vai como usuário do Basic Auth, senha vazia.
  return 'Basic ' + Buffer.from((process.env.PAGARME_API_KEY || '') + ':').toString('base64');
}

async function chamar(metodo, path, body) {
  if (!configurado()) { const e = new Error('Cobrança indisponível: configure PAGARME_API_KEY'); e.status = 503; throw e; }
  const r = await fetch(BASE + path, {
    method: metodo,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.message || 'Erro no pagar.me'); e.status = 502; e.detalhe = data; throw e; }
  return data;
}

// Verificação do webhook: HMAC-SHA256 do corpo CRU com PAGARME_WEBHOOK_SECRET, comparação em tempo
// constante. O nome do header e o formato exato devem bater com a config do webhook no painel do
// pagar.me — CONFIRMAR antes de produção (algumas contas usam Basic Auth no endpoint em vez de HMAC).
function verificarWebhook(rawBody, assinatura) {
  const secret = process.env.PAGARME_WEBHOOK_SECRET;
  if (!secret || !rawBody || !assinatura) return false;
  const esperado = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const recebido = String(assinatura).replace(/^sha256=/, '').trim();
  const a = Buffer.from(esperado);
  const b = Buffer.from(recebido);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { configurado, chamar, verificarWebhook, BASE };
