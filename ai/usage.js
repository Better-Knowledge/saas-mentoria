// ai/usage.js — medição de consumo de IA por organização e teto por plano (Princípio VII).
// ai_usage é tabela de tenant (RLS) → registrar/consultar dentro de withOrg.
const { withOrg } = require('../db');

// Orçamento de IA do plano (micro-USD por período), lido de features.ai_budget_micro_usd.
function orcamentoDoPlano(features) {
  const v = features && features.ai_budget_micro_usd;
  return Number.isFinite(v) ? v : null; // null = sem teto definido
}

// Consumo de IA da organização no mês corrente (micro-USD).
async function consumoPeriodo(orgId) {
  const { rows } = await withOrg(orgId, (c) => c.query(
    "SELECT COALESCE(SUM(custo_micro_usd),0)::bigint AS micro FROM ai_usage WHERE created_at >= date_trunc('month', now())"
  ));
  return Number(rows[0].micro);
}

async function dentroDoOrcamento(orgId, features) {
  const teto = orcamentoDoPlano(features);
  if (teto == null) return true;
  return (await consumoPeriodo(orgId)) < teto;
}

// Registra uma chamada de IA. org_id derivado do contexto (current_setting) sob RLS.
async function registrar(orgId, { tarefa, modelo, usage = {}, custo_micro_usd = 0 }) {
  await withOrg(orgId, (c) => c.query(`
    INSERT INTO ai_usage
      (org_id, tarefa, modelo, input_tokens, output_tokens, cached_input_tokens, custo_micro_usd, custo_centavos)
    VALUES (current_setting('app.current_org')::uuid, $1,$2,$3,$4,$5,$6,$7)`,
    [tarefa, modelo,
     usage.input_tokens || 0, usage.output_tokens || 0, usage.cache_read_input_tokens || 0,
     custo_micro_usd, Math.round(custo_micro_usd / 10000)]));
}

module.exports = { orcamentoDoPlano, consumoPeriodo, dentroDoOrcamento, registrar };
