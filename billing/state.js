// billing/state.js — máquina de estados da assinatura, alimentada por webhooks do pagar.me.
// Idempotente via billing_events (pagarme_event_id único). Ver contracts/billing-pagarme.md.
const { pool } = require('../db');

// evento do pagar.me → status local de assinatura (null = evento irrelevante).
function statusDoEvento(tipo) {
  switch (tipo) {
    case 'subscription.created':
    case 'subscription.activated':
    case 'invoice.paid':
    case 'charge.paid':
      return 'active';
    case 'invoice.payment_failed':
    case 'charge.payment_failed':
      return 'past_due';
    case 'subscription.canceled':
      return 'canceled';
    default:
      return null;
  }
}

// Extrai a referência da assinatura do pagar.me de um payload de evento (tolerante a formatos).
function refAssinatura(event) {
  const d = (event && event.data) || {};
  return d.subscription_id
    || (d.subscription && d.subscription.id)
    || (d.invoice && d.invoice.subscription_id)
    || (String(d.id || '').startsWith('sub_') ? d.id : null);
}

// Processa um evento de webhook de forma idempotente. event = { id, type, data }.
async function processarEvento(event) {
  const eventId = event && event.id;
  const tipo = event && event.type;
  if (!eventId || !tipo) { const e = new Error('Evento inválido'); e.status = 400; throw e; }

  // idempotência: insere; se já existia (reenvio), não reprocessa.
  const ins = await pool.query(
    `INSERT INTO billing_events (pagarme_event_id, tipo, payload)
     VALUES ($1, $2, $3) ON CONFLICT (pagarme_event_id) DO NOTHING RETURNING id`,
    [eventId, tipo, event]
  );
  if (ins.rowCount === 0) return { processado: false, duplicado: true };

  const novo = statusDoEvento(tipo);
  const ref = refAssinatura(event);
  let orgId = null;
  if (novo && ref) {
    const graceDias = Number(process.env.GRACE_DIAS || 5);
    const r = await pool.query(`
      UPDATE subscriptions SET
        status = $1,
        grace_until = CASE WHEN $1 = 'past_due' THEN now() + ($2 || ' days')::interval ELSE NULL END,
        updated_at = now()
      WHERE pagarme_subscription_id = $3
      RETURNING org_id`, [novo, String(graceDias), ref]);
    orgId = r.rows[0] && r.rows[0].org_id;
  }
  await pool.query(
    'UPDATE billing_events SET processado_em = now(), org_id = $1 WHERE pagarme_event_id = $2',
    [orgId, eventId]
  );
  return { processado: true, status: novo, orgId };
}

// Vencimentos (rodado por um agendador): trial expirado e carência esgotada → suspende (unpaid).
async function verificarVencimentos() {
  const r1 = await pool.query(
    "UPDATE subscriptions SET status='unpaid', updated_at=now() WHERE status='trialing' AND trial_end IS NOT NULL AND trial_end < now()"
  );
  const r2 = await pool.query(
    "UPDATE subscriptions SET status='unpaid', updated_at=now() WHERE status='past_due' AND grace_until IS NOT NULL AND grace_until < now()"
  );
  return { trials_expirados: r1.rowCount, carencias_esgotadas: r2.rowCount };
}

module.exports = { statusDoEvento, refAssinatura, processarEvento, verificarVencimentos };
