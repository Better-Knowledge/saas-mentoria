// scripts/verify-rls.js — PORTÃO de isolamento multi-tenant (Princípio V / FR-004 / SC-001).
//
// Prova, no banco, que o Row-Level Security isola as organizações:
//   - semeia 2 orgs + 1 cliente cada como superuser (RLS é bypassada por superuser);
//   - faz SET ROLE app_role (papel da aplicação, SUJEITO a RLS) e prova que cada org só
//     enxerga/escreve os seus dados, e que sem contexto a leitura é vazia (deny-by-default).
//
// Uso: DATABASE_URL=postgres://postgres:...@host:5432/saas node scripts/verify-rls.js
const { Client } = require('pg');

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  let pass = 0, fail = 0;
  const check = (cond, msg) => {
    if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m', msg); }
    else { fail++; console.log('  \x1b[31m✗\x1b[0m', msg); }
  };

  // --- Semear como superuser (RLS bypassada) ---
  await c.query('DELETE FROM interacoes; DELETE FROM clientes; DELETE FROM organizations;');
  const a = (await c.query("INSERT INTO organizations (nome) VALUES ('Org A') RETURNING id")).rows[0].id;
  const b = (await c.query("INSERT INTO organizations (nome) VALUES ('Org B') RETURNING id")).rows[0].id;
  await c.query("INSERT INTO clientes (org_id, nome) VALUES ($1,'Lead A')", [a]);
  await c.query("INSERT INTO clientes (org_id, nome) VALUES ($1,'Lead B')", [b]);

  console.log('\n[1] Baseline (superuser, RLS bypassada)');
  check((await c.query('SELECT count(*)::int n FROM clientes')).rows[0].n === 2, 'superuser enxerga os 2 clientes');

  // --- A partir daqui: papel da aplicação, RLS ATIVA ---
  await c.query('SET ROLE app_role');

  console.log('\n[2] app_role + contexto = Org A');
  await c.query("SELECT set_config('app.current_org', $1, false)", [a]);
  let r = await c.query('SELECT nome FROM clientes');
  check(r.rowCount === 1 && r.rows[0].nome === 'Lead A', 'enxerga só "Lead A" (1 linha)');

  console.log('\n[3] Trocar contexto para Org B');
  await c.query("SELECT set_config('app.current_org', $1, false)", [b]);
  r = await c.query('SELECT nome FROM clientes');
  check(r.rowCount === 1 && r.rows[0].nome === 'Lead B', 'enxerga só "Lead B" (1 linha)');

  console.log('\n[4] WITH CHECK impede escrever em outra org (contexto = Org A)');
  await c.query("SELECT set_config('app.current_org', $1, false)", [a]);
  let blocked = false;
  try { await c.query("INSERT INTO clientes (org_id, nome) VALUES ($1,'Intruso')", [b]); }
  catch (_) { blocked = true; }
  check(blocked, 'INSERT com org_id de outra org é recusado');

  console.log('\n[5] UPDATE/DELETE cross-org não atingem linhas');
  const upd = await c.query("UPDATE clientes SET nome='hack' WHERE nome='Lead B'");
  check(upd.rowCount === 0, 'UPDATE no "Lead B" (Org B) a partir da Org A afeta 0 linhas');
  const del = await c.query("DELETE FROM clientes WHERE nome='Lead B'");
  check(del.rowCount === 0, 'DELETE no "Lead B" (Org B) a partir da Org A afeta 0 linhas');

  console.log('\n[6] Deny-by-default (sem contexto)');
  await c.query("SELECT set_config('app.current_org', '', false)");
  r = await c.query('SELECT count(*)::int n FROM clientes');
  check(r.rows[0].n === 0, 'sem app.current_org → 0 linhas');

  await c.query('RESET ROLE');
  console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`);
  await c.end();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Erro na verificação:', e.message); process.exit(2); });
