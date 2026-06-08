/* eslint-disable camelcase */
// Fase 7 (IA por Lead): automação de IA configurável POR LEAD + documentos de contexto do Lead.
//  - clientes.ai_config (jsonb): o operador liga/desliga por Lead o que roda automático (sentimento)
//    e a auto-resposta autônoma; default preserva o comportamento atual (sentimento ligado).
//  - lead_documents (tenant, RLS): artefatos duráveis gerados a partir da conversa
//    (transcrição/resumo/documento contextual/proposta), anexados ao Lead.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- a) Config de automação de IA por Lead (default preserva o comportamento atual)
    ALTER TABLE clientes
      ADD COLUMN IF NOT EXISTS ai_config jsonb NOT NULL
      DEFAULT '{"auto_sentimento": true, "auto_resposta": false}'::jsonb;

    -- b) Documentos de contexto do Lead (tabela de tenant)
    CREATE TABLE IF NOT EXISTS lead_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      tipo text NOT NULL CHECK (tipo IN ('transcricao','resumo','documento','proposta')),
      titulo text NOT NULL,
      conteudo text NOT NULL,                  -- markdown / texto longo
      gerado_por_ia boolean NOT NULL DEFAULT true,
      origem jsonb,                            -- { selecao, brief, instrucao, modelo }
      created_by text NOT NULL DEFAULT 'humano' CHECK (created_by IN ('humano','ia')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_leaddocs_org_cli
      ON lead_documents (org_id, cliente_id, created_at DESC);

    -- RLS (mesmo padrão das demais tabelas de tenant): deny-by-default sem contexto de org
    ALTER TABLE lead_documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE lead_documents FORCE ROW LEVEL SECURITY;
    CREATE POLICY org_isolation ON lead_documents
      USING      (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
      WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

    -- GRANT explícito (defensivo; o ALTER DEFAULT PRIVILEGES da 0001 já cobriria)
    GRANT SELECT, INSERT, UPDATE, DELETE ON lead_documents TO app_role;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS lead_documents;
    ALTER TABLE clientes DROP COLUMN IF EXISTS ai_config;
  `);
};
