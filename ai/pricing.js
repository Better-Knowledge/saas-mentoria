// ai/pricing.js — preços por 1M de tokens (USD) e cálculo de custo em micro-dólares (USD * 1e6).
// micro-USD é inteiro e somável sem perda: (tokens / 1e6) * preço_por_1M * 1e6 = tokens * preço_por_1M.
// Confirme os valores na página de preços da Anthropic ao ajustar (skill claude-api).
const PRECOS = {
  'claude-haiku-4-5':  { in: 1.0,  out: 5.0  },
  'claude-sonnet-4-6': { in: 3.0,  out: 15.0 },
  'claude-opus-4-8':   { in: 5.0,  out: 25.0 },
};

function precoDe(modelo) {
  return PRECOS[modelo] || PRECOS['claude-sonnet-4-6'];
}

// Custo em micro-USD a partir do objeto usage da resposta da API.
function custoMicroUsd(modelo, usage = {}) {
  const p = precoDe(modelo);
  const inp = usage.input_tokens || 0;
  const out = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;       // ~0.1x do input
  const cacheWrite = usage.cache_creation_input_tokens || 0;  // ~1.25x do input (TTL 5min)
  return Math.round(inp * p.in + out * p.out + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25);
}

module.exports = { PRECOS, precoDe, custoMicroUsd };
