// scripts/verify-ai.js — verifica a LÓGICA de IA sem chamar a API (preços e roteamento por tarefa).
// A chamada real ao Claude é validada em produção (smoke do Gordon) onde a ANTHROPIC_API_KEY existe.
const pricing = require('../ai/pricing');
const router = require('../ai/router');

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', m); } else { fail++; console.log('  \x1b[31m✗\x1b[0m', m); } };

console.log('\n[1] Custo em micro-USD por modelo');
check(pricing.custoMicroUsd('claude-haiku-4-5', { input_tokens: 500, output_tokens: 200 }) === 1500,
  'Haiku 500 in + 200 out = 1500 micro-USD (500*1 + 200*5)');
check(pricing.custoMicroUsd('claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 100 }) === 4500,
  'Sonnet 1000 in + 100 out = 4500 micro-USD (1000*3 + 100*15)');
check(pricing.custoMicroUsd('claude-sonnet-4-6', { cache_read_input_tokens: 1000 }) === 300,
  'cache read Sonnet 1000 = 300 micro-USD (1000*3*0.1)');

console.log('\n[2] Roteamento por tarefa (Haiku/Sonnet/Opus)');
check(/haiku/.test(router.modeloParaTarefa('sentimento')), 'sentimento → Haiku');
check(/haiku/.test(router.modeloParaTarefa('triagem')), 'triagem → Haiku');
check(/sonnet/.test(router.modeloParaTarefa('gordon')), 'gordon → Sonnet');
check(/sonnet/.test(router.modeloParaTarefa('resumo')), 'resumo → Sonnet');
check(/opus/.test(router.modeloParaTarefa('raciocinio_complexo')), 'raciocínio complexo → Opus');

console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`);
process.exit(fail ? 1 : 0);
