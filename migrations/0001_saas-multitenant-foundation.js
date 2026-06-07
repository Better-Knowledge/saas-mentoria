/* eslint-disable camelcase */
// Migração inicial do SaaS multi-tenant (tarefas T005–T007).
// Cria as tabelas de plataforma e de tenant, habilita RLS nas tabelas de tenant, cria o papel
// de aplicação (sem BYPASSRLS) e popula o catálogo de planos. Ver specs/002-saas-multitenant/data-model.md.

exports.shorthands = undefined;

// Tabelas de tenant que recebem RLS por org_id (audit_log fica fora: é cross-cutting,
// filtrado na aplicação — tenant vê o seu org_id, operador lê via withoutOrg).
const TENANT_TABLES = [
  'clientes', 'interacoes', 'api_keys',
  'whatsapp_connections', 'whatsapp_messages', 'ai_usage',
];

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- ===================== PLATAFORMA (sem RLS) =====================
    CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nome text NOT NULL,
      estado text NOT NULL DEFAULT 'ativa' CHECK (estado IN ('ativa','suspensa','cancelada')),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE usuarios (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nome text NOT NULL,
      email text NOT NULL UNIQUE,
      senha_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      papel text NOT NULL DEFAULT 'owner' CHECK (papel IN ('owner','admin','assistente')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (usuario_id, org_id)
    );

    CREATE TABLE sessoes (
      token text PRIMARY KEY,
      usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      org_ativa uuid REFERENCES organizations(id) ON DELETE SET NULL,
      csrf text NOT NULL,
      expira_em timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      codigo text NOT NULL UNIQUE,
      nome text NOT NULL,
      preco_centavos bigint NOT NULL,
      limite_clientes integer,                 -- NULL = ilimitado
      features jsonb NOT NULL DEFAULT '{}'::jsonb,
      pagarme_plan_id text,
      ativo boolean NOT NULL DEFAULT true
    );

    CREATE TABLE subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      plan_id uuid REFERENCES plans(id),
      pagarme_subscription_id text UNIQUE,
      status text NOT NULL DEFAULT 'trialing'
        CHECK (status IN ('trialing','active','past_due','unpaid','canceled')),
      current_period_end timestamptz,
      grace_until timestamptz,
      trial_end timestamptz,                   -- fim do trial de 14 dias
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE billing_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pagarme_event_id text NOT NULL UNIQUE,   -- idempotência de webhook
      tipo text,
      org_id uuid,
      payload jsonb,
      processado_em timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- ===================== TENANT (com RLS) =====================
    CREATE TABLE clientes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      nome text NOT NULL,
      empresa text, cargo text, telefone text, email text,
      tipo_cliente text DEFAULT 'b2b',
      origem text,
      etapa text NOT NULL DEFAULT 'novo' CHECK (etapa IN ('novo','qualificacao','reuniao','proposta')),
      resultado text NOT NULL DEFAULT 'em_aberto' CHECK (resultado IN ('em_aberto','ganho','perdido')),
      valor_estimado numeric DEFAULT 0,
      proposta_enviada boolean DEFAULT false,
      status_pagamento text,
      proxima_acao text,
      proxima_acao_data text,                  -- 'YYYY-MM-DD' (a tela Hoje compara como texto)
      created_by text NOT NULL DEFAULT 'humano' CHECK (created_by IN ('humano','ia')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE interacoes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      texto text NOT NULL,
      tipo text NOT NULL DEFAULT 'nota'
        CHECK (tipo IN ('nota','resumo_ia','sentimento','mensagem_whatsapp')),
      gerado_por_ia boolean NOT NULL DEFAULT false,
      metadata jsonb,
      data timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE api_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      nome text NOT NULL,
      prefixo text NOT NULL,
      key_hash text NOT NULL,
      escopo text,
      ativa boolean NOT NULL DEFAULT true,
      ultimo_uso timestamptz,
      criada_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE whatsapp_connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,  -- 1 linha por org
      provider text NOT NULL CHECK (provider IN ('evolution','zapi')),
      instance_ref text,
      numero text,
      estado text NOT NULL DEFAULT 'desconectado'
        CHECK (estado IN ('desconectado','conectando','conectado')),
      webhook_secret_hash text,
      connected_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE whatsapp_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
      provider_msg_id text NOT NULL,
      direcao text NOT NULL CHECK (direcao IN ('entrada','saida')),
      remetente text, destinatario text,
      conteudo text,
      metadata jsonb,
      gerado_por_ia boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, provider_msg_id)         -- idempotência de mensagem
    );

    CREATE TABLE ai_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      tarefa text NOT NULL,
      modelo text NOT NULL,
      input_tokens integer NOT NULL DEFAULT 0,
      output_tokens integer NOT NULL DEFAULT 0,
      cached_input_tokens integer NOT NULL DEFAULT 0,
      custo_centavos bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Cross-cutting (sem RLS; filtrado na aplicação)
    CREATE TABLE audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid,
      ator_tipo text NOT NULL,
      ator_ref text,
      acao text NOT NULL,
      detalhe jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Índices compostos começando por org_id
    CREATE INDEX idx_clientes_org_updated  ON clientes (org_id, updated_at DESC);
    CREATE INDEX idx_clientes_org_telefone ON clientes (org_id, telefone);
    CREATE INDEX idx_interacoes_org_cli    ON interacoes (org_id, cliente_id);
    CREATE INDEX idx_apikeys_org           ON api_keys (org_id);
    CREATE INDEX idx_wamsg_org_created     ON whatsapp_messages (org_id, created_at);
    CREATE INDEX idx_aiusage_org_created   ON ai_usage (org_id, created_at);
    CREATE INDEX idx_audit_org_created     ON audit_log (org_id, created_at);
  `);

  // RLS por tabela de tenant. NULLIF(...,'')::uuid → sem contexto (NULL/''), nenhuma linha casa
  // (deny-by-default): leitura vazia, escrita recusada.
  for (const t of TENANT_TABLES) {
    pgm.sql(`
      ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
      CREATE POLICY org_isolation ON ${t}
        USING      (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
    `);
  }

  pgm.sql(`
    -- Papel da aplicação: SEM BYPASSRLS, sem superuser → sujeito às políticas acima.
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_role') THEN
        CREATE ROLE app_role NOLOGIN;
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA public TO app_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;

    -- Catálogo de planos (fonte de verdade local do gating)
    INSERT INTO plans (codigo, nome, preco_centavos, limite_clientes, features) VALUES
      ('basico', 'Básico', 3990, 5000,
        '{"gordon_chat":true,"relatorios_basicos":true,"relatorios_avancados":false,"automacoes_funil":false,"whatsapp_ia":false,"ia_avancada_conversas":false}'::jsonb),
      ('intermediario', 'Intermediário', 6990, 50000,
        '{"gordon_chat":true,"relatorios_basicos":true,"relatorios_avancados":true,"automacoes_funil":true,"whatsapp_ia":false,"ia_avancada_conversas":false}'::jsonb),
      ('vip', 'VIP', 29990, NULL,
        '{"gordon_chat":true,"relatorios_basicos":true,"relatorios_avancados":true,"automacoes_funil":true,"whatsapp_ia":true,"ia_avancada_conversas":true}'::jsonb);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS
      audit_log, ai_usage, whatsapp_messages, whatsapp_connections,
      api_keys, interacoes, clientes,
      billing_events, subscriptions, plans, sessoes, memberships, usuarios, organizations
    CASCADE;
    -- app_role e a extensão pgcrypto são deixados (podem ser compartilhados).
  `);
};
