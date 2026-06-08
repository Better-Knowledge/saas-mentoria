// operator/service.js — Painel do operador de plataforma (Fase 8). SOMENTE LEITURA, métricas
// agregadas. Consultas cross-tenant EXPLÍCITAS e AUDITADAS (Princípios II/IV/VI):
//  - tabelas de plataforma (organizations/subscriptions/plans/memberships/usuarios/billing_events)
//    não têm RLS → leitura direta;
//  - métricas de tabelas de TENANT (clientes, ai_usage) são lidas POR ORG dentro de withOrg, ou seja,
//    respeitando o RLS (o app continua sem BYPASSRLS). Nunca expõe o CONTEÚDO do CRM do cliente.
const db = require('../db');

// Toda ação do operador é registrada no audit_log (sem RLS; org_id NULL = cross-tenant).
async function audit(operadorId, acao, detalhe = null) {
  await db.query(
    `INSERT INTO audit_log (org_id, ator_tipo, ator_ref, acao, detalhe) VALUES (NULL, 'operador', $1, $2, $3)`,
    [String(operadorId), acao, detalhe]);
}

// Métricas de tenant de UMA org, lidas no contexto dela (RLS ativo).
async function metricasTenant(orgId) {
  return db.withOrg(orgId, async (c) => {
    const clientes = (await c.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n;
    const micro = (await c.query(
      "SELECT COALESCE(SUM(custo_micro_usd),0)::bigint AS m FROM ai_usage WHERE created_at >= date_trunc('month', now())"
    )).rows[0].m;
    return { clientes, ai_custo_micro_periodo: Number(micro) };
  });
}

async function overview(operadorId) {
  await audit(operadorId, 'operator.overview');
  const totalOrgs = (await db.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n;
  const totalUsuarios = (await db.query('SELECT count(*)::int AS n FROM usuarios')).rows[0].n;
  const porEstado = (await db.query('SELECT estado, count(*)::int AS n FROM organizations GROUP BY estado')).rows;
  const porAssinatura = (await db.query(`
    SELECT COALESCE(s.status,'sem_assinatura') AS status, COALESCE(p.codigo,'—') AS plano, count(*)::int AS n
    FROM organizations o
    LEFT JOIN subscriptions s ON s.org_id = o.id
    LEFT JOIN plans p ON p.id = s.plan_id
    GROUP BY s.status, p.codigo ORDER BY n DESC`)).rows;
  // Agregados de tenant: somados por org (loop withOrg → respeita RLS).
  const ids = (await db.query('SELECT id FROM organizations')).rows.map((r) => r.id);
  let totalClientes = 0, totalAiMicro = 0;
  for (const id of ids) {
    const m = await metricasTenant(id);
    totalClientes += m.clientes; totalAiMicro += m.ai_custo_micro_periodo;
  }
  return { totalOrgs, totalUsuarios, totalClientes, totalAiMicro, porEstado, porAssinatura };
}

async function listarOrgs(operadorId) {
  await audit(operadorId, 'operator.listarOrgs');
  const { rows } = await db.query(`
    SELECT o.id, o.nome, o.estado, o.created_at,
           p.codigo AS plano, p.nome AS plano_nome,
           s.status, s.trial_end, s.current_period_end,
           (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id) AS membros
    FROM organizations o
    LEFT JOIN subscriptions s ON s.org_id = o.id
    LEFT JOIN plans p ON p.id = s.plan_id
    ORDER BY o.created_at ASC`);
  for (const r of rows) {
    const m = await metricasTenant(r.id);
    r.clientes = m.clientes; r.ai_custo_micro_periodo = m.ai_custo_micro_periodo;
  }
  return rows;
}

async function detalheOrg(operadorId, orgId) {
  await audit(operadorId, 'operator.detalheOrg', { org_id: orgId });
  const org = (await db.query('SELECT id, nome, estado, created_at FROM organizations WHERE id = $1', [orgId])).rows[0];
  if (!org) { const e = new Error('Organização não encontrada'); e.status = 404; throw e; }
  const assinatura = (await db.query(`
    SELECT s.status, s.trial_end, s.current_period_end, s.grace_until,
           p.codigo AS plano, p.nome AS plano_nome, p.features
    FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.org_id = $1`, [orgId])).rows[0] || null;
  const membros = (await db.query(`
    SELECT u.nome, u.email, m.papel FROM memberships m JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.org_id = $1 ORDER BY m.created_at ASC`, [orgId])).rows;
  const metricas = await metricasTenant(orgId);
  const usoIA = await db.withOrg(orgId, (c) => c.query(`
    SELECT tarefa, count(*)::int AS chamadas, COALESCE(SUM(custo_micro_usd),0)::bigint AS micro
    FROM ai_usage WHERE created_at >= date_trunc('month', now()) GROUP BY tarefa ORDER BY micro DESC`));
  const cobranca = (await db.query(
    'SELECT tipo, created_at FROM billing_events WHERE org_id = $1 ORDER BY created_at DESC LIMIT 10', [orgId])).rows;
  return {
    org, assinatura, membros, metricas,
    uso_ia: usoIA.rows.map((r) => ({ tarefa: r.tarefa, chamadas: r.chamadas, micro: Number(r.micro) })),
    cobranca,
  };
}

module.exports = { overview, listarOrgs, detalheOrg, audit, metricasTenant };
