// scripts/verify-operator.js — Painel do operador (Fase 8): consultas cross-tenant agregadas,
// SOMENTE LEITURA e AUDITADAS, respeitando o RLS (métricas de tenant lidas por org via withOrg).
//
// Importante: o serviço roda como app_login (SUJEITO a RLS), como em produção — senão as métricas
// por org não isolariam. O seed é feito por uma conexão superuser à parte.
//   SUPER_DATABASE_URL=postgres://postgres:...  (seed)
//   DATABASE_URL=postgres://app_login:...       (serviço, RLS ativo)
process.env.OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || 'op@test.local';
const { Client } = require('pg');
const db = require('../db');           // usa DATABASE_URL (app_login)
const auth = require('../auth');
const operator = require('../operator/service');

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', m); } else { fail++; console.log('  \x1b[31m✗\x1b[0m', m); } };

async function main() {
  const su = new Client({ connectionString: process.env.SUPER_DATABASE_URL });
  await su.connect();

  // ---- Seed (superuser; RLS bypassada) ----
  await su.query('DELETE FROM audit_log; DELETE FROM ai_usage; DELETE FROM lead_documents; DELETE FROM whatsapp_messages; DELETE FROM interacoes; DELETE FROM clientes; DELETE FROM memberships; DELETE FROM subscriptions; DELETE FROM usuarios; DELETE FROM organizations;');
  const orgA = (await su.query("INSERT INTO organizations (nome) VALUES ('Org A') RETURNING id")).rows[0].id;
  const orgB = (await su.query("INSERT INTO organizations (nome,estado) VALUES ('Org B','suspensa') RETURNING id")).rows[0].id;
  const planVip = (await su.query("SELECT id FROM plans WHERE codigo='vip'")).rows[0].id;
  const planBas = (await su.query("SELECT id FROM plans WHERE codigo='basico'")).rows[0].id;
  await su.query("INSERT INTO subscriptions (org_id, plan_id, status) VALUES ($1,$2,'active')", [orgA, planVip]);
  await su.query("INSERT INTO subscriptions (org_id, plan_id, status) VALUES ($1,$2,'trialing')", [orgB, planBas]);
  // usuários: um operador (por e-mail) e um comum
  const uOp = (await su.query("INSERT INTO usuarios (nome,email,senha_hash) VALUES ('Op','op@test.local','x') RETURNING id")).rows[0].id;
  await su.query("INSERT INTO usuarios (nome,email,senha_hash) VALUES ('Comum','user@test.local','x')");
  await su.query("INSERT INTO memberships (usuario_id, org_id, papel) VALUES ($1,$2,'owner')", [uOp, orgA]);
  // clientes: 2 na Org A, 1 na Org B
  await su.query("INSERT INTO clientes (org_id,nome) VALUES ($1,'A1'),($1,'A2')", [orgA]);
  await su.query("INSERT INTO clientes (org_id,nome) VALUES ($1,'B1')", [orgB]);
  // uso de IA na Org A (mês corrente)
  await su.query("INSERT INTO ai_usage (org_id,tarefa,modelo,custo_micro_usd) VALUES ($1,'resumo','sonnet',1500),($1,'sentimento','haiku',500)", [orgA]);

  console.log('\n[1] Papel de operador: default + ensureOperator');
  check((await su.query("SELECT is_operator FROM usuarios WHERE email='user@test.local'")).rows[0].is_operator === false, 'is_operator default = false');
  await auth.ensureOperator(); // promove OPERATOR_EMAIL (op@test.local) via app_login
  check((await su.query("SELECT is_operator FROM usuarios WHERE email='op@test.local'")).rows[0].is_operator === true, 'ensureOperator promove o e-mail do operador');

  console.log('\n[2] overview: agregados cross-tenant');
  const ov = await operator.overview(uOp);
  check(ov.totalOrgs === 2, 'totalOrgs = 2');
  check(ov.totalClientes === 3, 'totalClientes = 3 (2 A + 1 B)');
  check(ov.totalAiMicro === 2000, 'totalAiMicro = 2000 (1500+500)');
  check(Array.isArray(ov.porEstado) && ov.porEstado.some(e => e.estado === 'suspensa' && e.n === 1), 'porEstado inclui 1 suspensa');

  console.log('\n[3] listarOrgs: métricas por org isoladas (RLS via withOrg como app_login)');
  const orgs = await operator.listarOrgs(uOp);
  const rA = orgs.find(o => o.id === orgA), rB = orgs.find(o => o.id === orgB);
  check(rA && rA.clientes === 2 && rA.plano === 'vip', 'Org A: 2 clientes, plano vip');
  check(rB && rB.clientes === 1 && rB.status === 'trialing', 'Org B: 1 cliente, trialing');
  check(rA.ai_custo_micro_periodo === 2000 && rB.ai_custo_micro_periodo === 0, 'custo de IA isolado por org (A=2000, B=0)');

  console.log('\n[4] detalheOrg');
  const det = await operator.detalheOrg(uOp, orgA);
  check(det.org.nome === 'Org A' && det.metricas.clientes === 2, 'detalhe traz org + métricas');
  check(det.membros.length === 1 && det.membros[0].email === 'op@test.local', 'lista membros da org');
  check(det.uso_ia.length === 2, 'uso de IA por tarefa (2 tarefas)');
  let nf = false; try { await operator.detalheOrg(uOp, '00000000-0000-0000-0000-000000000000'); } catch (e) { nf = e.status === 404; }
  check(nf, 'org inexistente → 404');

  console.log('\n[5] auditoria: toda ação registra audit_log');
  const aud = (await su.query("SELECT count(*)::int n FROM audit_log WHERE ator_tipo='operador' AND ator_ref=$1", [uOp])).rows[0].n;
  check(aud >= 4, `audit_log registrou as ações do operador (${aud} >= 4)`);

  console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`);
  await su.end();
  await db.pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Erro na verificação:', e.message, e.stack); process.exit(2); });
