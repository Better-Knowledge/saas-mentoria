// scripts/verify-billing.js — teste de integração de cobrança + gating (Fases 3–4).
// Exercita os módulos reais (auth signup→assinatura, billing entitlements, state webhooks,
// crm limite) como app_login (RLS ativa). Uso: DATABASE_URL=... node scripts/verify-billing.js
const db = require('../db');
const auth = require('../auth');
const billing = require('../billing/plans');
const state = require('../billing/state');
const crm = require('../crm-service');

let pass = 0, fail = 0;
const check = (c, m) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', m); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', m); }
};

(async () => {
  await db.query("DELETE FROM billing_events");
  await db.query("DELETE FROM usuarios WHERE email='carla@c.com'");
  await db.query("DELETE FROM organizations WHERE nome='Org C'");

  console.log('\n[1] Signup cria assinatura trial no Básico');
  const C = await auth.signup({ nome: 'Carla', email: 'carla@c.com', senha: 'senha12345', nomeOrg: 'Org C' });
  let sub = await billing.assinaturaDaOrg(C.org.id);
  let ents = billing.entitlements(sub);
  check(sub && sub.status === 'trialing' && sub.plano_codigo === 'basico', 'assinatura trialing no Básico');
  check(ents.acesso === true && ents.limite_clientes === 5000, 'entitlements: acesso + limite 5000');
  check(ents.features.gordon_chat === true && ents.features.whatsapp_ia === false, 'features Básico (gordon sim, whatsapp_ia não)');

  console.log('\n[2] Limite de clientes imposto em crm-service (REST/MCP/Gordon)');
  await db.query("UPDATE plans SET limite_clientes=2 WHERE codigo='basico'");
  await db.withOrg(C.org.id, (c) => crm.criarCliente(c, { nome: 'c1' }, 'humano'));
  await db.withOrg(C.org.id, (c) => crm.criarCliente(c, { nome: 'c2' }, 'humano'));
  let blocked = false;
  try { await db.withOrg(C.org.id, (c) => crm.criarCliente(c, { nome: 'c3' }, 'humano')); }
  catch (e) { blocked = e.status === 403; }
  check(blocked, '3º cliente bloqueado no limite (ErroDominio 403)');
  await db.query("UPDATE plans SET limite_clientes=5000 WHERE codigo='basico'");

  console.log('\n[3] Webhook: máquina de estados + idempotência');
  await db.query("UPDATE subscriptions SET pagarme_subscription_id='sub_test' WHERE org_id=$1", [C.org.id]);
  const r1 = await state.processarEvento({ id: 'evt_1', type: 'invoice.payment_failed', data: { subscription_id: 'sub_test' } });
  sub = await billing.assinaturaDaOrg(C.org.id);
  check(r1.processado && sub.status === 'past_due' && !!sub.grace_until, 'payment_failed → past_due + carência');
  const dup = await state.processarEvento({ id: 'evt_1', type: 'invoice.payment_failed', data: { subscription_id: 'sub_test' } });
  check(dup.duplicado === true, 'reenvio do mesmo evento é ignorado (idempotente)');
  await state.processarEvento({ id: 'evt_2', type: 'invoice.paid', data: { subscription_id: 'sub_test' } });
  sub = await billing.assinaturaDaOrg(C.org.id);
  check(sub.status === 'active' && !sub.grace_until, 'invoice.paid → active (carência limpa)');

  console.log('\n[4] Entitlements por plano (gating de features)');
  const vip = billing.entitlements({ status: 'active', plano_codigo: 'vip', limite_clientes: null, features: { whatsapp_ia: true } });
  check(vip.features.whatsapp_ia === true && vip.limite_clientes === null, 'VIP: whatsapp_ia + ilimitado');
  const susp = billing.entitlements({ status: 'unpaid', plano_codigo: 'basico', limite_clientes: 5000, features: { gordon_chat: true } });
  check(susp.acesso === false && Object.keys(susp.features).length === 0, 'suspenso (unpaid): sem acesso, sem features');

  console.log('\n[5] Vencimento de trial → suspende');
  await db.query("UPDATE subscriptions SET status='trialing', trial_end=now() - interval '1 day' WHERE org_id=$1", [C.org.id]);
  await state.verificarVencimentos();
  sub = await billing.assinaturaDaOrg(C.org.id);
  ents = billing.entitlements(sub);
  check(sub.status === 'unpaid' && ents.acesso === false, 'trial expirado → unpaid + sem acesso');

  console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`);
  await db.pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nFALHA:', e.message, '\n', e.stack); process.exit(2); });
