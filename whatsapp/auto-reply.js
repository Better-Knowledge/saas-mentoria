// whatsapp/auto-reply.js — motor de auto-resposta autônoma POR LEAD (opt-in).
// Ação outward-facing: ENVIA WhatsApp real. Por isso só roda quando o operador ligou `auto_resposta`
// no Lead (verificado pelo chamador) e sempre com salvaguardas: rate limit por Lead + handoff para
// humano (pedido explícito de humano, sentimento negativo, ou a IA sinalizando que não deve responder).
const crypto = require('crypto');
const { withOrg } = require('../db');
const ai = require('../ai/tasks');
const crm = require('../crm-service');
const { adapterFor } = require('./provider');

const RATE_PADRAO = { max: 5, janela_min: 10 };
// Pedido explícito de atendimento humano → handoff sem custo de IA.
const RE_HUMANO = /\b(falar|atend\w*|quero)\b.*\b(humano|atendente|pessoa|gerente|respons[aá]vel)\b|\bhumano\b|\batendente\b/i;

// conn = conexão da org (com creds, vinda do webhook). Pré-condições (feature + orçamento + auto_resposta
// ligado) já checadas pelo chamador. `sentimentoPrecalc` reusa o sentimento já calculado no inbound.
async function responder(conn, { clienteId, telefone, inbound, aiConfig = {}, sentimentoPrecalc = null }) {
  const orgId = conn.org_id;
  const texto = (inbound || '').trim();
  if (!texto) return { enviado: false, handoff: false };

  const rl = (aiConfig.rate_limite && typeof aiConfig.rate_limite === 'object') ? aiConfig.rate_limite : RATE_PADRAO;

  // 1) Rate limit por Lead (conta respostas automáticas recentes).
  const recentes = await withOrg(orgId, (c) => c.query(
    `SELECT COUNT(*)::int AS n FROM whatsapp_messages
     WHERE cliente_id = $1 AND direcao = 'saida' AND gerado_por_ia = true
       AND created_at > now() - ($2 || ' minutes')::interval`,
    [clienteId, String(rl.janela_min || RATE_PADRAO.janela_min)]));
  if (recentes.rows[0].n >= (rl.max || RATE_PADRAO.max)) {
    return { enviado: false, handoff: false, rateLimited: true };
  }

  // 2) Handoff determinístico: pedido explícito de humano (sem custo).
  if (RE_HUMANO.test(texto)) return _handoff(orgId, clienteId, conn, 'lead pediu atendimento humano');

  // 3) Sentimento (reusa o já calculado se disponível) → negativo dispara handoff.
  let sent = sentimentoPrecalc;
  if (sent == null) { try { sent = await ai.sentimento(orgId, texto); } catch (_) { sent = null; } }
  if (sent === 'negativo') return _handoff(orgId, clienteId, conn, 'sentimento negativo do lead');

  // 4) Gera a resposta a partir do histórico recente da conversa.
  const historico = await _historico(orgId, clienteId);
  let r;
  try { r = await ai.autoResposta(orgId, historico, aiConfig.persona || ''); }
  catch (e) { console.error('autoResposta IA:', e.message); return { enviado: false, handoff: false, erro: e.message }; }
  if (r.handoff || !r.texto) return _handoff(orgId, clienteId, conn, r.motivo || 'IA sem resposta segura');

  // 5) Envia via provider da org e registra a saída (idempotente) + interação.
  const adapter = adapterFor(conn.provider);
  let env;
  try { env = await adapter.sendMessage(conn, telefone, r.texto); }
  catch (e) { console.error('sendMessage:', e.message); return { enviado: false, handoff: false, erro: e.message }; }
  const pmid = (env && env.provider_msg_id) || ('auto-' + crypto.randomBytes(8).toString('hex'));

  await withOrg(orgId, async (c) => {
    await c.query(`
      INSERT INTO whatsapp_messages (org_id, cliente_id, provider_msg_id, direcao, remetente, destinatario, conteudo, gerado_por_ia)
      VALUES (current_setting('app.current_org')::uuid, $1,$2,'saida',NULL,$3,$4,true)
      ON CONFLICT (org_id, provider_msg_id) DO NOTHING`,
      [clienteId, pmid, telefone, r.texto]);
    await crm.registrarInteracaoTipo(c, clienteId, {
      texto: r.texto, tipo: 'mensagem_whatsapp', gerado_por_ia: true, metadata: { auto: true, para: telefone },
    });
  });
  return { enviado: true, handoff: false };
}

// Histórico recente como mensagens de chat (entrada=user, saida=assistant), ordem cronológica.
async function _historico(orgId, clienteId) {
  const { rows } = await withOrg(orgId, (c) => c.query(
    `SELECT direcao, conteudo FROM whatsapp_messages
     WHERE cliente_id = $1 AND conteudo IS NOT NULL AND conteudo <> ''
     ORDER BY created_at DESC LIMIT 15`, [clienteId]));
  return rows.reverse().map((m) => ({ role: m.direcao === 'saida' ? 'assistant' : 'user', content: m.conteudo }));
}

// Handoff: desliga a auto-resposta do Lead, registra uma nota e NÃO envia nada.
async function _handoff(orgId, clienteId, conn, motivo) {
  await withOrg(orgId, async (c) => {
    await crm.atualizarAiConfig(c, clienteId, { auto_resposta: false });
    await crm.registrarInteracaoTipo(c, clienteId, {
      texto: `Auto-resposta pausada — handoff para humano: ${motivo}`, tipo: 'nota', gerado_por_ia: true,
      metadata: { handoff: true, motivo },
    });
  });
  return { enviado: false, handoff: true, motivo };
}

module.exports = { responder };
