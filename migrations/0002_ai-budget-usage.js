/* eslint-disable camelcase */
// Tarefas T028/T039/T040: custo de IA em micro-USD + orçamento de IA por plano (features).
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS custo_micro_usd bigint NOT NULL DEFAULT 0;

    -- Orçamento de IA por período (micro-USD = USD * 1e6) — protege a margem (Princípio VII).
    UPDATE plans SET features = features || '{"ai_budget_micro_usd": 2000000}'::jsonb  WHERE codigo = 'basico';        -- ~US$ 2
    UPDATE plans SET features = features || '{"ai_budget_micro_usd": 8000000}'::jsonb  WHERE codigo = 'intermediario'; -- ~US$ 8
    UPDATE plans SET features = features || '{"ai_budget_micro_usd": 30000000}'::jsonb WHERE codigo = 'vip';           -- ~US$ 30
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE ai_usage DROP COLUMN IF EXISTS custo_micro_usd;`);
};
