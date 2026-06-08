# Data Model — SaaS Multi-Tenant (PostgreSQL + RLS)

**Feature**: `002-saas-multitenant` · **Date**: 2026-06-07

> Migração de SQLite single-file para **PostgreSQL** com **Row-Level Security**. Toda tabela de tenant
> carrega `org_id` e tem política RLS. A aplicação conecta com um papel **sem `BYPASSRLS`** e define
> `app.current_org` por transação (`SET LOCAL`). Tipos: `uuid` (PKs e FKs de org), `timestamptz`
> (datas), `bigint`/`numeric` para dinheiro em **centavos**, `jsonb` para metadados. PKs `uuid` evitam
> enumeração entre tenants. SQL abaixo é ilustrativo (as migrações reais vivem em `migrations/`).

## Convenções

- **`org_id uuid NOT NULL`** em toda tabela de tenant; FK → `organizations(id)`; índice composto
  começando por `org_id`.
- **Auditoria**: `created_by text` (`humano`|`ia`) e/ou `gerado_por_ia boolean`, **derivados da
  credencial** (nunca do corpo). `created_at`/`updated_at timestamptz default now()`.
- **Dinheiro** em centavos (`bigint`) para evitar float.
- **Enums** via `CHECK` ou tipos `ENUM` do Postgres (abaixo uso `text` + `CHECK` por simplicidade de
  migração).

## Contexto RLS (aplicado a toda tabela de tenant)

```sql
-- Papel da aplicação (sem BYPASSRLS) é criado fora da migração (provisionamento do banco).
-- Padrão de política reutilizado em cada tabela de tenant:
ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <tabela> FORCE ROW LEVEL SECURITY;            -- vale até para o dono da tabela
CREATE POLICY org_isolation ON <tabela>
  USING      (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);
```

```js
// db.js — helper de transação que aplica o contexto de org (resumo)
async function withOrg(orgId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]); // SET LOCAL
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
// withoutOrg(fn): para signup, webhooks (antes de resolver a org) e operador — consultas explícitas,
// sem depender do setting; nunca usado por crm-service no caminho de tenant.
```

> Como `current_setting('app.current_org', true)` retorna `NULL` sem o setting, **nenhuma** linha casa
> → leitura vazia e escrita recusada (padrão "negar"). Esse é o portão de isolamento (Princípio V).

---

## Entidades de plataforma (não-tenant ou raiz de tenant)

### `organizations` — a conta pagante (raiz do isolamento)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK (`gen_random_uuid()`) | identidade da organização |
| `nome` | text NOT NULL | nome da conta/empresa |
| `estado` | text NOT NULL default `ativa` | `ativa`·`suspensa`·`cancelada` |
| `created_at` | timestamptz default now() | |

- Sem RLS por `org_id` (é a própria raiz); acesso a `organizations` é por membership do usuário ou pelo
  operador. Leitura de uma org pelo usuário é mediada pela aplicação (membership).

### `usuarios` — pessoa que faz login (modificada)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `nome` | text NOT NULL | |
| `email` | text NOT NULL UNIQUE | login |
| `senha_hash` | text NOT NULL | bcrypt |
| `created_at` | timestamptz | |

- O `papel` deixa de ser global e passa a viver em `memberships` (por org). Um usuário pode pertencer a
  várias orgs.

### `memberships` — vínculo usuário ↔ organização

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `usuario_id` | uuid FK→usuarios | |
| `org_id` | uuid FK→organizations | |
| `papel` | text NOT NULL | `owner`·`admin`·`assistente` |
| `created_at` | timestamptz | |
| | | UNIQUE(`usuario_id`,`org_id`) |

### `sessoes` — sessão de login (modificada)

Mantém `token`, `usuario_id`, `csrf`, `expira_em`, e ganha **`org_ativa uuid`** (organização ativa da
sessão). A troca de org ativa atualiza esse campo. Não é tabela de tenant (chaveada por usuário/sessão).

### `plans` — catálogo de planos (fonte de verdade local do gating)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `codigo` | text UNIQUE | `basico`·`intermediario`·`vip` |
| `nome` | text | "Básico"/"Intermediário"/"VIP" |
| `preco_centavos` | bigint | 3990 · 6990 · 29990 |
| `limite_clientes` | integer NULL | 5000 · 50000 (Inter., configurável) · NULL=ilimitado |
| `features` | jsonb | ex.: `{"gordon_chat":true,"relatorios_avancados":false,"whatsapp_ia":false,...}` |
| `pagarme_plan_id` | text NULL | referência ao plano no pagar.me |
| `ativo` | boolean default true | |

### `subscriptions` — assinatura da organização (pagar.me)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK→organizations (UNIQUE — 1 assinatura corrente por org) | |
| `plan_id` | uuid FK→plans | |
| `pagarme_subscription_id` | text UNIQUE NULL | id no pagar.me |
| `status` | text NOT NULL | `trialing`·`active`·`past_due`·`unpaid`·`canceled` |
| `current_period_end` | timestamptz NULL | fim do período vigente |
| `grace_until` | timestamptz NULL | fim da carência (inadimplência) |
| `trial_end` | timestamptz NULL | fim do **trial de 14 dias** (acesso pleno até lá) |
| `created_at`/`updated_at` | timestamptz | |

- **Entitlements** = `plans.features`/`limite_clientes` do `plan_id` **se** `status ∈ {trialing,active}`
  ou (`past_due` e `now() < grace_until`); caso contrário → acesso suspenso (somente leitura/upgrade).
- RLS opcional aqui (chaveada por `org_id`), mas como o acesso é sempre mediado pela app por org,
  aplicar RLS dá consistência.

### `billing_events` — idempotência de webhooks do pagar.me

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `pagarme_event_id` | text UNIQUE NOT NULL | **chave de idempotência** |
| `tipo` | text | ex.: `subscription.created`, `invoice.paid`, `invoice.payment_failed`, `subscription.canceled` |
| `org_id` | uuid NULL | resolvido a partir do payload |
| `payload` | jsonb | bruto (para auditoria/reprocesso) |
| `processado_em` | timestamptz NULL | |
| `created_at` | timestamptz | |

- Inserção com `ON CONFLICT (pagarme_event_id) DO NOTHING` → reenvio não reprocessa (FR-008).

---

## Entidades de tenant (RLS por `org_id`)

### `clientes` — lead/cliente do CRM (modificada: + `org_id`)

Campos atuais preservados (`nome`, `empresa`, `cargo`, `telefone`, `email`, `tipo_cliente`, `origem`,
`etapa`, `resultado`, `valor_estimado`, `proposta_enviada`, `status_pagamento`, `proxima_acao`,
`proxima_acao_data`, `created_by`, `created_at`, `updated_at`) + **`org_id uuid NOT NULL`** + **`id`
uuid**. Enums de `etapa`/`resultado` idênticos à v1. `telefone` ganha índice por `(org_id, telefone)`
para casar mensagens de WhatsApp ao lead.

```sql
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON clientes
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);
CREATE INDEX ON clientes (org_id, updated_at DESC);
CREATE INDEX ON clientes (org_id, telefone);
```

- **Limite de clientes (gating)**: a contagem por org (`SELECT count(*) FROM clientes` dentro de
  `withOrg`) é comparada ao `limite_clientes` do plano antes de criar (FR-012), em UI/API/MCP.

### `interacoes` — histórico do lead (modificada: + `org_id`, + tipo/metadata)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | RLS |
| `cliente_id` | uuid FK→clientes | |
| `texto` | text NOT NULL | ≤ 5000 |
| `tipo` | text default `nota` | `nota`·`resumo_ia`·`sentimento`·`mensagem_whatsapp` |
| `gerado_por_ia` | boolean default false | derivado da credencial/IA |
| `metadata` | jsonb NULL | ex.: rótulo de sentimento, modelo usado, id da conversa |
| `data`/`created_at` | timestamptz | |

- Resumos/sentimentos de IA entram como `interacoes` com `tipo` próprio e `gerado_por_ia=true`
  (aparecem no histórico do lead — FR-021).

### `api_keys` — chave de máquina por organização (modificada: + `org_id`)

Campos atuais (`nome`, `prefixo`, `key_hash`, `ativa`, `ultimo_uso`, `criada_por`, `created_at`) +
**`org_id uuid NOT NULL`** + **`id` uuid** + (futuro) `escopo text`. `verificarApiKey` passa a retornar
o `org_id`; o MCP roda em `withOrg(org_id)`. RLS por `org_id` (a org só vê/gera/revoga as suas chaves).

### `whatsapp_connections` — a linha conectada (uma por org, VIP)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL UNIQUE | **uma linha por organização** |
| `provider` | text | `evolution`·`zapi` |
| `instance_ref` | text | id/instância no provider |
| `numero` | text NULL | número conectado (E.164) quando conhecido |
| `estado` | text | `desconectado`·`conectando`·`conectado` |
| `webhook_secret` | text | segredo por instância (verificação de inbound) — guardado como hash |
| `connected_at` | timestamptz NULL | |
| `created_at`/`updated_at` | timestamptz | |

- RLS por `org_id`. `UNIQUE(org_id)` impõe FR-019 (uma linha por org). Conexão/desconexão auditada.

### `whatsapp_messages` — mensagens recebidas/enviadas

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | RLS |
| `cliente_id` | uuid FK→clientes NULL | lead associado pelo telefone |
| `provider_msg_id` | text | **id externo — idempotência** |
| `direcao` | text | `entrada`·`saida` |
| `remetente`/`destinatario` | text | E.164 |
| `conteudo` | text | corpo (texto); mídia → referência/metadata |
| `metadata` | jsonb NULL | tipo de mídia, timestamps do provider |
| `gerado_por_ia` | boolean default false | saída gerada por auto-atendimento |
| `created_at` | timestamptz | |
| | | UNIQUE(`org_id`,`provider_msg_id`) |

- `UNIQUE(org_id, provider_msg_id)` + `ON CONFLICT DO NOTHING` → mensagem duplicada do provider não
  duplica registro (FR-018, SC-006). RLS por `org_id`.

### `ai_usage` — medição de consumo de IA por organização (governança de custo)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | RLS; base do teto por org |
| `tarefa` | text | `sentimento`·`resumo`·`auto_resposta`·`gordon`·`relatorio`·... |
| `modelo` | text | id do modelo usado (Haiku/Sonnet/Opus) |
| `input_tokens`/`output_tokens` | integer | da resposta da API |
| `cached_input_tokens` | integer default 0 | tokens servidos do cache de prompt |
| `custo_centavos` | bigint | calculado pela tabela de preços em config |
| `created_at` | timestamptz | |

- Rollup periódico (job) agrega por org/período para comparar ao **orçamento do plano** (FR-024). Índice
  `(org_id, created_at)`.

### `audit_log` — eventos sensíveis

| Campo | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NULL | org afetada (NULL para ações de plataforma) |
| `ator_tipo` | text | `usuario`·`apikey`·`operador`·`sistema` |
| `ator_ref` | text | id/rótulo do ator |
| `acao` | text | `plano_alterado`·`whatsapp_conectado`·`whatsapp_desconectado`·`cliente_excluido`·`org_suspensa`·... |
| `detalhe` | jsonb NULL | |
| `created_at` | timestamptz | |

- Para eventos do operador, `org_id` aponta a org alvo; consultas do operador são cross-tenant
  explícitas (fora do `withOrg` de tenant) e elas próprias auditadas (FR-026/028).

---

## Fila (`pg-boss`)

`pg-boss` cria e gerencia o seu próprio schema (filas, jobs, estados, retry). **Não** é tabela de tenant
(o `org_id` viaja no **payload** do job). Filas previstas: `whatsapp.ingest`, `ai.summarize`,
`ai.sentiment`, `ai.autoreply`, `billing.process_event`, `billing.reconcile`, `ai.usage_rollup`. Os
handlers reabrem o contexto com `withOrg(payload.org_id, …)` ao tocar dados de tenant.

## Principal (em memória, não persistido)

```text
// pessoa (sessão)
principal = { tipo:'humano', credencial:'sessao', usuario_id, org_id:<org_ativa>, papel, csrf }
// máquina (chave/MCP) — escopada à org da chave
principal = { tipo:'ia', credencial:'apikey', id:<api_keys.id>, org_id:<api_keys.org_id>, nome }
// operador
principal = { tipo:'operador', credencial:'sessao', usuario_id }   // acesso cross-tenant explícito
```

`crm-service` deriva `autor` (`humano`/`ia`) **e** roda dentro de `withOrg(principal.org_id, …)` —
isolamento + auditoria a partir da credencial.

## Estados e invariantes

- **Isolamento**: sem `app.current_org`, toda tabela de tenant é vazia para leitura e recusa escrita.
  Nenhuma operação de tenant roda fora de `withOrg`.
- **Assinatura**: `status` evolui por webhooks verificados; entitlements derivam só do estado verificado
  (Princípio VI). `UNIQUE(org_id)` → uma assinatura corrente por org.
- **WhatsApp**: `UNIQUE(org_id)` em `whatsapp_connections` (uma linha); `UNIQUE(org_id, provider_msg_id)`
  em `whatsapp_messages` (idempotência).
- **Cobrança**: `billing_events.pagarme_event_id` único → webhook idempotente. **Trial de 14 dias**
  (`trial_end`); **somente cartão**; orgs `canceled`/`unpaid` retidas **90 dias** antes da purga (LGPD).
- **IA**: toda saída gravada tem `gerado_por_ia=true` e consumo registrado em `ai_usage`; teto por org
  respeitado antes de novas chamadas.
- **Auditoria**: todo registro de tenant tem `org_id` correto e autor não-falsificável.

## Migração da base atual (SQLite → org inicial)

`scripts/migrate-sqlite-to-pg.js`: cria a **organização inicial** + o usuário admin atual como `owner`,
e copia `clientes`/`interacoes` atribuindo o `org_id` dessa org, preservando `created_by`/datas e
convertendo PKs inteiros para uuid (mapa id-antigo→uuid para manter os FKs de `interacoes`). As
`api_keys` atuais são reescopadas para a org inicial. Rodada uma única vez, idempotente por verificação
de "já migrado".
