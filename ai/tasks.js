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

// Formata uma data ISO/timestamptz como dd/mm hh:mm (pt-BR), de forma estável.
function _carimbo(d) {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
  } catch (_) { return ''; }
}

// Transcrição de um trecho da conversa. Determinística por padrão (fiel, sem custo de IA).
// `mensagens`: [{ direcao:'entrada'|'saida', conteudo, created_at }]. opts.limpar → revisa via Haiku.
// Retorna { texto, usouIA }.
async function transcrever(orgId, mensagens, opts = {}) {
  const linhas = (mensagens || [])
    .filter((m) => m && m.conteudo)
    .map((m) => {
      const quem = m.direcao === 'saida' ? 'Você' : 'Lead';
      const ts = _carimbo(m.created_at);
      return `${ts ? `[${ts}] ` : ''}${quem}: ${m.conteudo}`;
    });
  const bruto = linhas.join('\n');
  if (!opts.limpar || !bruto) return { texto: bruto, usouIA: false };
  // Limpeza leve opcional (ortografia/pontuação), preservando o conteúdo e os rótulos.
  const system = 'Revise levemente a transcrição abaixo (ortografia e pontuação), SEM alterar o sentido, '
    + 'sem inventar conteúdo e mantendo os rótulos "Lead:" e "Você:" e a ordem das mensagens.';
  const r = await _exec(orgId, 'transcricao', { system, messages: [{ role: 'user', content: bruto }], maxTokens: 1500 });
  return { texto: r.texto || bruto, usouIA: true };
}

// Documento contextual durável do Lead a partir da conversa/contexto (Sonnet).
async function gerarDocumento(orgId, contexto, instrucao = '') {
  const system = 'Você organiza informações de um lead de vendas em um documento de contexto objetivo, em '
    + 'português do Brasil, em markdown. Use apenas o que está no material fornecido; não invente dados. '
    + 'Estruture com seções úteis (ex.: Quem é o lead, Necessidade/dor, Histórico, Próximos passos).'
    + (instrucao ? `\nInstrução adicional do operador: ${instrucao}` : '');
  const r = await _exec(orgId, 'documento', { system, messages: [{ role: 'user', content: String(contexto || '') }], maxTokens: 1500 });
  return r.texto;
}

// Proposta comercial a partir do contexto do Lead + brief do operador (Sonnet).
async function gerarProposta(orgId, contexto, brief = '') {
  const system = 'Você redige uma proposta comercial clara e persuasiva (português do Brasil, markdown) para '
    + 'um serviço de mentoria, com base no contexto do lead e no brief do operador. Seja concreto sobre '
    + 'escopo e próximos passos. Não invente preços ou condições que não estejam no brief; quando faltar '
    + 'um dado essencial, deixe um marcador claro como [PREENCHER: ...].'
    + (brief ? `\nBrief do operador: ${brief}` : '');
  const r = await _exec(orgId, 'proposta', { system, messages: [{ role: 'user', content: String(contexto || '') }], maxTokens: 1500 });
  return r.texto;
}

// Resposta autônoma a um lead (Sonnet). `historico`: [{ role:'user'|'assistant', content }].
// A IA sinaliza handoff respondendo apenas "[HANDOFF] <motivo>" quando não deve responder sozinha.
// Retorna { texto, handoff, motivo }.
async function autoResposta(orgId, historico = [], persona = '') {
  const system = [
    'Você é um atendente comercial de uma mentoria, respondendo no WhatsApp em português do Brasil. '
    + 'Seja cordial, breve e útil; faça no máximo uma pergunta por vez para qualificar o lead.',
    persona ? `Persona/diretrizes desta organização: ${persona}` : '',
    'IMPORTANTE: se o cliente pedir para falar com um humano/atendente, se você não tiver informação '
    + 'para responder com segurança, ou se houver insatisfação grave, NÃO responda normalmente — '
    + 'responda APENAS com "[HANDOFF] <motivo curto>".',
  ].filter(Boolean).join('\n');

  let hist = (historico || []).filter((m) => m && m.role && m.content).slice(-15);
  while (hist.length && hist[0].role !== 'user') hist.shift(); // a 1ª mensagem deve ser do usuário
  if (!hist.length) return { texto: '', handoff: true, motivo: 'sem histórico' };

  const r = await _exec(orgId, 'auto_resposta', { system, messages: hist, maxTokens: 500 });
  const texto = (r.texto || '').trim();
  const m = texto.match(/^\[HANDOFF\]\s*(.*)$/i);
  if (m) return { texto: '', handoff: true, motivo: (m[1] || 'IA solicitou handoff').trim() };
  return { texto, handoff: false, motivo: null };
}

module.exports = { gordon, sentimento, resumir, transcrever, gerarDocumento, gerarProposta, autoResposta };
