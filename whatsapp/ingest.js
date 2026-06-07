// whatsapp/ingest.js — ingestão de mensagens inbound: normaliza → associa/cria lead → grava
// mensagem (idempotente) + interação no histórico → dispara IA (sentimento), tudo na org correta.
const { withOrg } = require('../db');
const crm = require('../crm-service');
const ai = require('../ai/tasks');
const aiUsage = require('../ai/usage');
const billing = require('../billing/plans');
const { adapterFor } = require('./provider');

// conn = conexão da org (com creds). payload = corpo do webhook do provider.
async function ingestInbound(conn, payload) {
  const adapter = adapterFor(conn.provider);
  const msg = adapter.parseInbound(payload);
  if (!msg || msg.direcao !== 'entrada' || !msg.remetente) return { ignorado: true };
  const orgId = conn.org_id;

  const r = await withOrg(orgId, async (c) => {
    // 1) lead pelo telefone (cria se novo — VIP é ilimitado, então não esbarra no limite)
    let cli = (await c.query('SELECT id, nome FROM clientes WHERE telefone = $1 ORDER BY created_at LIMIT 1', [msg.remetente])).rows[0];
    let novo = false;
    if (!cli) {
      cli = await crm.criarCliente(c, { nome: msg.metadata.pushName || msg.remetente, telefone: msg.remetente, origem: 'WhatsApp' }, 'ia');
      novo = true;
    }
    // 2) mensagem idempotente por (org, provider_msg_id)
    const ins = await c.query(`
      INSERT INTO whatsapp_messages (org_id, cliente_id, provider_msg_id, direcao, remetente, destinatario, conteudo, metadata)
      VALUES (current_setting('app.current_org')::uuid, $1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (org_id, provider_msg_id) DO NOTHING RETURNING id`,
      [cli.id, msg.provider_msg_id, msg.direcao, msg.remetente, msg.destinatario, msg.conteudo, msg.metadata || {}]);
    if (ins.rowCount === 0) return { duplicada: true };
    // 3) também no histórico do lead (aparece na ficha)
    if (msg.conteudo) {
      await c.query(`
        INSERT INTO interacoes (org_id, cliente_id, texto, tipo, gerado_por_ia, metadata)
        VALUES (current_setting('app.current_org')::uuid, $1, $2, 'mensagem_whatsapp', false, $3)`,
        [cli.id, msg.conteudo, { de: msg.remetente }]);
    }
    return { clienteId: cli.id, novo, conteudo: msg.conteudo };
  });

  if (r.duplicada) return { duplicada: true };

  // 4) IA: sentimento (Haiku) — só VIP e dentro do orçamento de IA da org
  const sub = await billing.assinaturaDaOrg(orgId);
  const ents = billing.entitlements(sub);
  if (ents.features.whatsapp_ia && r.conteudo && (await aiUsage.dentroDoOrcamento(orgId, ents.features))) {
    try {
      const sentimento = await ai.sentimento(orgId, r.conteudo);
      await withOrg(orgId, (c) => c.query(`
        INSERT INTO interacoes (org_id, cliente_id, texto, tipo, gerado_por_ia, metadata)
        VALUES (current_setting('app.current_org')::uuid, $1, $2, 'sentimento', true, $3)`,
        [r.clienteId, `Sentimento do lead: ${sentimento}`, { sentimento, fonte: 'whatsapp' }]));
    } catch (e) { console.error('IA sentimento (whatsapp):', e.message); }
  }
  return { ok: true, clienteId: r.clienteId, novoLead: r.novo };
}

module.exports = { ingestInbound };
