// scripts/verify-cutover.js — teste de integração do cutover multi-tenant.
//
// Exercita os MÓDULOS REAIS portados (db, auth, crm-service) conectados como o papel de aplicação
// (sujeito a RLS), provando ponta a ponta: signup de organizações, isolamento entre elas, auditoria
// derivada da credencial e chaves de API escopadas por organização.
//
// Uso: DATABASE_URL=postgres://app_login:...@host:5432/saas node scripts/verify-cutover.js
const db = require('../db');
const auth = require('../auth');
const crm = require('../crm-service');

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m', msg); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', msg); }
}

(async () => {
  // limpeza idempotente (caso rode 2x no mesmo banco)
  await db.query("DELETE FROM usuarios WHERE email IN ('alice@a.com','bob@b.com')");
  await db.query("DELETE FROM organizations WHERE nome IN ('Org A','Org B')");

  console.log('\n[1] Signup de duas organizações');
  const A = await auth.signup({ nome: 'Alice', email: 'alice@a.com', senha: 'senha12345', nomeOrg: 'Org A' });
  const B = await auth.signup({ nome: 'Bob', email: 'bob@b.com', senha: 'senha12345', nomeOrg: 'Org B' });
  check(A.org.id && B.org.id && A.org.id !== B.org.id, 'duas organizações distintas criadas');

  console.log('\n[2] Criar cliente na Org A (auditoria humano)');
  const cliA = await db.withOrg(A.org.id, (c) => crm.criarCliente(c, { nome: 'Lead da A', origem: 'Teste' }, 'humano'));
  check(cliA.id && cliA.created_by === 'humano', 'cliente criado com created_by=humano e org_id próprio');

  console.log('\n[3] Isolamento de leitura entre organizações');
  const listA = await db.withOrg(A.org.id, (c) => crm.listarClientes(c));
  const listB = await db.withOrg(B.org.id, (c) => crm.listarClientes(c));
  check(listA.length === 1, 'Org A vê 1 cliente');
  check(listB.length === 0, 'Org B vê 0 clientes (isolada)');

  console.log('\n[4] Org B não acessa o cliente da Org A (404)');
  let naoEncontrado = false;
  try { await db.withOrg(B.org.id, (c) => crm.obterCliente(c, cliA.id)); }
  catch (e) { naoEncontrado = e.status === 404; }
  check(naoEncontrado, 'obterCliente da Org A a partir da Org B → ErroDominio 404');

  console.log('\n[5] Interação IA + export (auditoria derivada da credencial)');
  const inter = await db.withOrg(A.org.id, (c) => crm.registrarInteracao(c, cliA.id, 'Primeira conversa', 'ia'));
  check(inter.gerado_por_ia === true, 'interação marcada como gerada por IA');
  const exp = await db.withOrg(A.org.id, (c) => crm.exportarCliente(c, cliA.id));
  check(exp.interacoes.length === 1, 'export LGPD traz a ficha + 1 interação');

  console.log('\n[6] Chave de API escopada à organização');
  const key = await auth.criarApiKey({ nome: 'Agente A', orgId: A.org.id, criadaPor: A.usuario.id });
  const k = await auth.verificarApiKey(key.chave);
  check(k && k.org_id === A.org.id, 'verificarApiKey devolve o org_id da chave');
  const keysB = await auth.listarApiKeys(B.org.id);
  check(keysB.length === 0, 'a chave da Org A não aparece na Org B');

  console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`);
  await db.pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nFALHA:', e.message, '\n', e.stack); process.exit(2); });
