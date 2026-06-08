// ai/claude.js — cliente Anthropic (Claude) + medição de tokens/custo.
// Mínimo necessário enviado; saída de IA sempre marcada como gerada por IA pelo chamador.
const Anthropic = require('@anthropic-ai/sdk');
const { custoMicroUsd } = require('./pricing');
const { modeloParaTarefa } = require('./router');

let _client = null;
function client() {
  if (!_client) _client = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente
  return _client;
}
function configurado() { return !!process.env.ANTHROPIC_API_KEY; }

// Chama o Claude para uma tarefa. `system` pode ser string ou array de blocos (com cache_control).
// Retorna { texto, modelo, usage, custo_micro_usd }.
async function completar({ tarefa, modelo, system, messages, maxTokens = 1024 }) {
  if (!configurado()) { const e = new Error('IA indisponível: configure ANTHROPIC_API_KEY'); e.status = 503; throw e; }
  const mdl = modelo || modeloParaTarefa(tarefa);
  const resp = await client().messages.create({
    model: mdl,
    max_tokens: maxTokens,
    system,
    messages,
  });
  const texto = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const usage = resp.usage || {};
  return { texto, modelo: mdl, usage, custo_micro_usd: custoMicroUsd(mdl, usage) };
}

module.exports = { completar, configurado };
