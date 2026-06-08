// scripts/verify-ia-lead.js — IA por Lead: documentos (RLS), config por lead, motor de auto-resposta
// (handoff + rate limit) e a decisão do ingest. Roda contra um Postgres descartável já migrado.
//
// Uso: DATABASE_URL=postgres://postgres:...@host:5432/saas node scripts/verify-ia-lead.js
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
const { Client } = require('pg');
const db = require('../db');

let pass = 0, fail = 0;
const check = (cond, msg) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m', msg); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', msg); }
};

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // ---- Limpeza + seed (superuser; RLS bypassada para semear) ----
  await c.query('DELETE FROM lead_documents; DELETE FROM whatsapp_messages; DELETE FROM interacoes; DELETE FROM clientes; DELETE FROM organizations;');
  const orgA = (await c.query("INSERT INTO organizations (nome) VALUES ('Org A') RETURNING id")).rows[0].id;
  const orgB = (await c.query("INSERT INTO organizations (nome) VALUES ('Org B') RETURNING id")).rows[0].id;
  const leadA = (await c.query("INSERT INTO clientes (org_id, nome, telefone) VALUES ($1,'Lead A','5511000001') RETURNING id", [orgA])).rows[0].id;
  const leadB = (await c.query("INSERT INTO clientes (org_id, nome, telefone) VALUES ($1,'Lead B','5511000002') RETURNING id", [orgB])).rows[0].id;

  console.log('\n[1] ai_config: default e merge defensivo');
  const cfgA = (await c.query('SELECT ai_config FROM clientes WHERE id = $1', [leadA])).rows[0].ai_config;
  check(cfgA && cfgA.auto_sentimento === true && cfgA.auto_resposta === false, 'default = {auto_sentimento:true, auto_resposta:false}');
  await c.query(`UPDATE clientes SET ai_config = ai_config || '{"auto_resposta":true,"persona":"P"}'::jsonb WHERE id = $1`, [leadA]);
  const cfgA2 = (await c.query('SELECT ai_config FROM clientes WHERE id = $1', [leadA])).rows[0].ai_config;
  check(cfgA2.auto_sentimento === true && cfgA2.auto_resposta === true && cfgA2.persona === 'P', 'merge preserva chaves e aplica patch');
  await c.query(`UPDATE clientes SET ai_config = '{"auto_sentimento":true,"auto_resposta":false}'::jsonb WHERE id = $1`, [leadA]); // reset

  console.log('\n[2] lead_documents: RLS isola por org (SET ROLE app_role)');
  await c.query("INSERT INTO lead_documents (org_id, cliente_id, tipo, titulo, conteudo) VALUES ($1,$2,'resumo','R','conteudo')", [orgA, leadA]);
  await c.query('SET ROLE app_role');
  await c.query("SELECT set_config('app.current_org', $1, false)", [orgA]);
  check((await c.query('SELECT count(*)::int n FROM lead_documents')).rows[0].n === 1, 'Org A enxerga seu documento');
  await c.query("SELECT set_config('app.current_org', $1, false)", [orgB]);
  check((await c.query('SELECT count(*)::int n FROM lead_documents')).rows[0].n === 0, 'Org B não enxerga documento da Org A');
  let blocked = false;
  try { await c.query("INSERT INTO lead_documents (org_id, cliente_id, tipo, titulo, conteudo) VALUES ($1,$2,'resumo','X','y')", [orgA, leadA]); }
  catch (_) { blocked = true; }
  check(blocked, 'WITH CHECK recusa inserir documento com org_id de outra org');
  await c.query('RESET ROLE');

  // ===================== Motor de auto-resposta (mocks de IA e envio) =====================
  // Mocks: substituem as funções nos módulos cacheados (auto-reply usa essas referências).
  const aiTasks = require('../ai/tasks');
  const evolution = require('../whatsapp/evolution');
  const autoReply = require('../whatsapp/auto-reply');
  let enviou = null;
  evolution.sendMessage = async (conn, to, text) => { enviou = { to, text }; return { provider_msg_id: 'OUT-' + text.length }; };
  aiTasks.autoResposta = async () => ({ texto: 'Olá! Como posso ajudar?', handoff: false, motivo: null });
  aiTasks.sentimento = async () => 'neutro';

  const conn = { org_id: orgA, provider: 'evolution', instance_ref: 'inst', base_url: 'http://x', api_key: 'k' };
  const limpaConversa = async () => {
    await db.withOrg(orgA, async (cl) => {
      await cl.query('DELETE FROM whatsapp_messages WHERE cliente_id = $1', [leadA]);
      await cl.query('DELETE FROM interacoes WHERE cliente_id = $1', [leadA]);
      await cl.query(`UPDATE clientes SET ai_config = '{"auto_sentimento":true,"auto_resposta":true}'::jsonb WHERE id = $1`, [leadA]);
    });
  };

  console.log('\n[3] Auto-resposta: caminho feliz (envia + grava saída)');
  await limpaConversa(); enviou = null;
  let r = await autoReply.responder(conn, { clienteId: leadA, telefone: '5511000001', inbound: 'oi', aiConfig: { auto_resposta: true }, sentimentoPrecalc: 'neutro' });
  check(r.enviado === true && enviou && enviou.text.includes('Como posso ajudar'), 'envia a resposta gerada pela IA');
  const saidas = await db.withOrg(orgA, (cl) => cl.query("SELECT count(*)::int n FROM whatsapp_messages WHERE cliente_id=$1 AND direcao='saida' AND gerado_por_ia", [leadA]));
  check(saidas.rows[0].n === 1, 'grava a saída em whatsapp_messages (gerado_por_ia)');

  console.log('\n[4] Auto-resposta: handoff por pedido de humano (não envia, desliga auto)');
  await limpaConversa(); enviou = null;
  r = await autoReply.responder(conn, { clienteId: leadA, telefone: '5511000001', inbound: 'quero falar com um humano', aiConfig: { auto_resposta: true } });
  check(r.handoff === true && r.enviado === false && enviou === null, 'não envia e marca handoff (keyword, sem chamar IA de envio)');
  const cfgPos = await db.withOrg(orgA, (cl) => cl.query('SELECT ai_config FROM clientes WHERE id=$1', [leadA]));
  check(cfgPos.rows[0].ai_config.auto_resposta === false, 'auto_resposta é desligada no lead após handoff');
  const nota = await db.withOrg(orgA, (cl) => cl.query("SELECT count(*)::int n FROM interacoes WHERE cliente_id=$1 AND tipo='nota' AND texto LIKE 'Auto-resposta pausada%'", [leadA]));
  check(nota.rows[0].n === 1, 'registra nota de handoff no histórico');

  console.log('\n[5] Auto-resposta: handoff por sentimento negativo');
  await limpaConversa(); enviou = null;
  r = await autoReply.responder(conn, { clienteId: leadA, telefone: '5511000001', inbound: 'que serviço horrível', aiConfig: { auto_resposta: true }, sentimentoPrecalc: 'negativo' });
  check(r.handoff === true && enviou === null, 'sentimento negativo → handoff, sem envio');

  console.log('\n[6] Auto-resposta: rate limit por lead');
  await limpaConversa(); enviou = null;
  await db.withOrg(orgA, async (cl) => {
    for (let i = 0; i < 5; i++) {
      await cl.query(`INSERT INTO whatsapp_messages (org_id, cliente_id, provider_msg_id, direcao, conteudo, gerado_por_ia)
        VALUES (current_setting('app.current_org')::uuid, $1, $2, 'saida', 'x', true)`, [leadA, 'pre-' + i]);
    }
  });
  r = await autoReply.responder(conn, { clienteId: leadA, telefone: '5511000001', inbound: 'oi de novo', aiConfig: { auto_resposta: true, rate_limite: { max: 5, janela_min: 10 } }, sentimentoPrecalc: 'neutro' });
  check(r.rateLimited === true && enviou === null, 'após 5 respostas na janela → rateLimited, não envia');

  // ===================== Decisão do ingest (mock billing/usage/IA/auto-resposta) =====================
  console.log('\n[7] ingest respeita a config de IA do lead');
  const billing = require('../billing/plans');
  const aiUsage = require('../ai/usage');
  billing.assinaturaDaOrg = async () => ({});
  billing.entitlements = () => ({ features: { whatsapp_ia: true } });
  aiUsage.dentroDoOrcamento = async () => true;
  let chamouSentimento = 0, chamouAuto = 0;
  aiTasks.sentimento = async () => { chamouSentimento++; return 'neutro'; };
  autoReply.responder = async () => { chamouAuto++; return { enviado: true }; };
  const ingest = require('../whatsapp/ingest');
  const payload = (id, texto) => ({ event: 'messages.upsert', instance: 'inst', data: {
    key: { remoteJid: '5511000001@s.whatsapp.net', fromMe: false, id }, pushName: 'Lead A',
    message: { conversation: texto }, messageTimestamp: 1 } });

  await db.withOrg(orgA, (cl) => cl.query(`UPDATE clientes SET ai_config = '{"auto_sentimento":false,"auto_resposta":false}'::jsonb WHERE id=$1`, [leadA]));
  await ingest.ingestInbound(conn, payload('IN-1', 'tudo desligado'));
  check(chamouSentimento === 0 && chamouAuto === 0, 'auto_sentimento/auto_resposta off → IA não é chamada');

  await db.withOrg(orgA, (cl) => cl.query(`UPDATE clientes SET ai_config = '{"auto_sentimento":true,"auto_resposta":true}'::jsonb WHERE id=$1`, [leadA]));
  await ingest.ingestInbound(conn, payload('IN-2', 'tudo ligado'));
  check(chamouSentimento === 1 && chamouAuto === 1, 'auto_sentimento+auto_resposta on → sentimento e motor são chamados');

  console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`);
  await c.end();
  await db.pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Erro na verificação:', e.message, e.stack); process.exit(2); });
