// ai/tasks.js — tarefas de IA: Gordon (chat ciente do CRM), resumo e sentimento de conversas.
// Cada tarefa roteia o modelo por tarefa (router) e mede o consumo por organização (usage).
const claude = require('./claude');
const usage = require('./usage');
const { withOrg } = require('../db');
const crm = require('../crm-service');

// Executa uma tarefa e registra o consumo na organização.
async function _exec(orgId, tarefa, args) {
  const r = await claude.completar({ tarefa, ...args });
  await usage.registrar(orgId, { tarefa, modelo: r.modelo, usage: r.usage, custo_micro_usd: r.custo_micro_usd });
  return r;
}

// Gordon: assistente de chat (todos os planos) ciente do CRM da organização.
async function gordon(orgId, mensagem, historico = []) {
  // Contexto somente-leitura do CRM para o system prompt.
  const ctx = await withOrg(orgId, async (c) => {
    const hoje = await crm.acoesHoje(c);
    const total = (await c.query('SELECT COUNT(*)::int AS n FROM clientes')).rows[0].n;
    return { atrasados: hoje.atrasados.length, hoje: hoje.hoje.length, futuros: hoje.futuros.length, total };
  });
  const system = [{
    type: 'text',
    text:
      'Você é o Gordon, assistente de CRM da plataforma, em português do Brasil. Ajuda a organizar o ' +
      'funil de vendas, priorizar follow-ups e redigir mensagens. Seja direto, prático e conciso.\n' +
      `Contexto do CRM desta organização: ${ctx.total} clientes; follow-ups — ${ctx.atrasados} atrasados, ` +
      `${ctx.hoje} para hoje, ${ctx.futuros} futuros.`,
    cache_control: { type: 'ephemeral' },
  }];
  let hist = (historico || []).filter((m) => m && m.role && m.content).slice(-10);
  while (hist.length && hist[0].role !== 'user') hist.shift(); // a 1ª mensagem deve ser do usuário
  const messages = [...hist, { role: 'user', content: String(mensagem || '') }];
  const r = await _exec(orgId, 'gordon', { system, messages, maxTokens: 1024 });
  return r.texto;
}

// Sentimento de uma mensagem/conversa de lead (Haiku). Retorna positivo|neutro|negativo.
async function sentimento(orgId, texto) {
  const system = 'Classifique o sentimento da mensagem do cliente. Responda APENAS com uma palavra: positivo, neutro ou negativo.';
  const r = await _exec(orgId, 'sentimento', { system, messages: [{ role: 'user', content: String(texto || '') }], maxTokens: 8 });
  const t = (r.texto || '').toLowerCase();
  if (t.includes('positiv')) return 'positivo';
  if (t.includes('negativ')) return 'negativo';
  return 'neutro';
}

// Resumo de uma conversa de WhatsApp (Sonnet).
async function resumir(orgId, texto) {
  const system = 'Resuma a conversa de WhatsApp a seguir em 1 a 3 frases objetivas (português), destacando a intenção do lead e os próximos passos.';
  const r = await _exec(orgId, 'resumo', { system, messages: [{ role: 'user', content: String(texto || '') }], maxTokens: 300 });
  return r.texto;
}

module.exports = { gordon, sentimento, resumir };
