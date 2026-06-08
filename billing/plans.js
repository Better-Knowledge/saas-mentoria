// billing/plans.js — catálogo de planos (lido do banco) + cálculo de entitlements a partir da
// assinatura da organização. As tabelas plans/subscriptions são cross-cutting (sem RLS); o acesso é
// sempre filtrado por org_id na aplicação. Entitlements derivam SÓ do estado verificado (Princípio VI).
const { pool } = require('../db');

const STATUS_ACESSO = ['trialing', 'active'];

async function listarPlanos() {
  return (await pool.query(
    'SELECT codigo, nome, preco_centavos, limite_clientes, features FROM plans WHERE ativo = true ORDER BY preco_centavos'
  )).rows;
}

async function planoPorCodigo(codigo) {
  return (await pool.query('SELECT * FROM plans WHERE codigo = $1', [codigo])).rows[0] || null;
}

// Assinatura + plano de uma organização (ou null).
async function assinaturaDaOrg(orgId) {
  return (await pool.query(`
    SELECT s.*, p.codigo AS plano_codigo, p.nome AS plano_nome, p.limite_clientes, p.features
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.org_id = $1`, [orgId])).rows[0] || null;
}

// A organização tem acesso ao plano agora? trialing/active, ou past_due dentro da carência.
function temAcesso(sub) {
  if (!sub) return false;
  if (STATUS_ACESSO.includes(sub.status)) return true;
  if (sub.status === 'past_due' && sub.grace_until && new Date(sub.grace_until) > new Date()) return true;
  return false;
}

// Entitlements efetivos (o que a org pode fazer agora).
function entitlements(sub) {
  const acesso = temAcesso(sub);
  return {
    plano: sub ? sub.plano_codigo : null,
    plano_nome: sub ? sub.plano_nome : null,
    status: sub ? sub.status : 'sem_assinatura',
    acesso,
    trial_end: sub ? sub.trial_end : null,
    limite_clientes: acesso ? sub.limite_clientes : 0,     // sem acesso → 0 (não cria)
    features: acesso ? (sub.features || {}) : {},
  };
}

module.exports = { STATUS_ACESSO, listarPlanos, planoPorCodigo, assinaturaDaOrg, temAcesso, entitlements };
