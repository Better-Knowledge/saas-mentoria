---
description: "Task list for SaaS Multi-Tenant — Planos, Cobrança, WhatsApp, IA"
---

# Tasks: SaaS Multi-Tenant — Planos, Cobrança (pagar.me), WhatsApp e IA Claude

**Input**: Design documents from `/specs/002-saas-multitenant/`

**Prerequisites**: [plan.md](plan.md) (required), [spec.md](spec.md) (user stories), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: O spec **não** pediu testes automatizados; o projeto valida manualmente (constituição:
"verificação manual antes de concluir"). As tarefas de validação referenciam [quickstart.md](quickstart.md).
**Portões obrigatórios**: isolamento multi-tenant (RLS) e idempotência/assinatura de webhook.

**Organization**: Tarefas agrupadas por user story para implementação e validação independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: a qual user story a tarefa pertence (US1..US7)
- Caminhos de arquivo são relativos à raiz do repositório `saas-mentoria/`

## Path Conventions

- Projeto único, mesmo processo Express + **worker** de fila (mesmo código). Sem `src/`, sem build.
  Código novo em `tenancy/ billing/ whatsapp/ ai/ jobs/ operator/`; migrações em `migrations/`;
  lógica de domínio compartilhada em `crm-service.js`; wiring em `server.js`/`auth.js`/`db.js`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependências, variáveis de ambiente e esqueleto de pastas. Não altera o app rodando (que
segue em SQLite até o cutover, T048).

- [ ] T001 Atualizar `package.json`: adicionar `pg`, `node-pg-migrate`, `pg-boss`, `@anthropic-ai/sdk`; scripts `migrate` (node-pg-migrate) e `worker` (jobs/worker.js). Manter `better-sqlite3` até o cutover.
- [ ] T002 [P] Atualizar `.env.example`: `DATABASE_URL`, `PAGARME_API_KEY`, `PAGARME_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `WHATSAPP_PROVIDER`, `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `ZAPI_*`, `APP_URL`, `TRIAL_DIAS=14`, `RETENCAO_DIAS=90`
- [ ] T003 [P] `docker-compose.yml`: serviço `postgres` (volume persistente) + serviço `evolution` (provider inicial) + serviço `worker`; rotas de webhook (`/webhooks/*`) no Traefik com TLS
- [ ] T004 [P] Criar esqueleto de pastas: `tenancy/`, `billing/`, `whatsapp/`, `ai/`, `jobs/`, `operator/`, `migrations/`, `scripts/`

**Checkpoint**: dependências e estrutura prontas; app de produção intacto.

---

## Phase 2: Foundational (Multi-Tenant + RLS) — entrega US1 e **BLOQUEIA tudo**

**Purpose**: Banco multi-tenant com isolamento no banco (RLS), contas/organização ativa, MCP escopado e
migração da base atual. **⚠️ CRITICAL**: nenhuma outra user story começa antes desta fase.

- [ ] T005 Migração inicial (`migrations/`): extensão `pgcrypto`; tabelas de plataforma `organizations`, `usuarios`, `memberships`, `sessoes` (+`org_ativa`), `plans`, `subscriptions` (+`trial_end`), `billing_events` conforme [data-model.md](data-model.md)
- [ ] T006 Migração: `org_id uuid` + **RLS** (`ENABLE`+`FORCE`+policy `org_isolation`) em `clientes`, `interacoes`, `api_keys`; criar `whatsapp_connections`, `whatsapp_messages`, `ai_usage`, `audit_log` (todas com `org_id`+RLS); índices compostos por `org_id`; criar papel de aplicação **sem `BYPASSRLS`** + grants (depende T005)
- [ ] T007 Seed do catálogo de planos (`basico` 3990/5000, `intermediario` 6990/50000, `vip` 29990/∞) com `features` JSON (depende T005)
- [ ] T008 `db.js` → pool `pg` + helpers `withOrg(orgId, fn)` (`SET LOCAL app.current_org`) e `withoutOrg(fn)`; substitui o `better-sqlite3` no caminho de dados (depende T005, T006)
- [ ] T009 `crm-service.js`: portar todas as queries para `pg`/`withOrg` (clientes, interações, hoje, export, excluir), preservando validação/enums/auditoria; cada operação roda no contexto de org (depende T008)
- [ ] T010 [US1] `auth.js`: `signup` (cria `usuarios`+`organizations`+`memberships owner`); sessão carrega `org_ativa`; `resolverPrincipal` resolve `org_id` (sessão→`org_ativa`, chave→`api_keys.org_id`); `verificarApiKey` retorna `org_id` (depende T008)
- [ ] T011 [US1] `server.js`: bootstrap async; rotas `/api/auth/signup`, `/api/orgs`, `/api/orgs/ativa`, `/api/auth/me` (retorna org/plano/entitlements); middleware que popula `req.principal` (com `org_id`) e roda escritas em `withOrg` (depende T009, T010)
- [ ] T012 [US1] MCP escopado por org: `mcp/server.mjs` executa cada ferramenta em `withOrg(principal.org_id, …)`; `requireBearer` popula `org_id` (depende T010, T009)
- [ ] T013 [US1] `scripts/migrate-sqlite-to-pg.js`: migra a base atual (`crm.db`) para a **organização inicial** (clientes/interações/api_keys), mapa id-inteiro→uuid, preservando `created_by`/datas; idempotente (depende T005, T006)
- [ ] T014 [P] [US1] Front (`public/`): tela de **signup** e seletor de **organização ativa**; `me` reflete plano/entitlements
- [ ] T015 [US1] **Validação (PORTÃO de isolamento)**: criar Org A e Org B; provar via API e MCP que A não lê/edita/exclui dados de B (→ `404`); provar no banco que sem `app.current_org` a leitura é vazia. (quickstart Passos 1–2) (depende T011, T012, T013)

**Checkpoint**: app multi-tenant com isolamento verificado; base atual migrada. User stories podem começar.

---

## Phase 3: User Story 2 - Assinar plano e pagar (Priority: P1) 🎯 MVP cobrável

**Goal**: organização assina Básico/Intermediário/VIP via pagar.me; permissões derivam do estado
verificado; trial de 14 dias; inadimplência/cancelamento tratados.

**Independent Test**: assinar cada plano em sandbox; webhook idempotente; assinatura inválida rejeitada;
trial→cobrança; falha→carência→suspensão. (quickstart Passos 3, 8)

- [ ] T016 [US2] `billing/plans.js`: catálogo local + entitlements derivados de `plan.features`/`status`
- [ ] T017 [US2] `billing/pagarme.js`: cliente HTTP (customers, subscriptions, plans) via `fetch`
- [ ] T018 [US2] `billing/webhooks.js`: verificação de assinatura (`PAGARME_WEBHOOK_SECRET`, tempo constante) + idempotência (`billing_events` `ON CONFLICT`) + mapeamento evento→`subscriptions.status` (depende T017)
- [ ] T019 [US2] `server.js`: `POST /webhooks/pagarme` (aceitar-e-enfileirar), `GET /api/billing`, `POST /api/billing/subscribe|change-plan|cancel` (depende T018)
- [ ] T020 [US2] `jobs/`: handlers `billing.process_event`, `billing.trial_check` (fim do trial 14d → cobra ou suspende), `billing.reconcile` (webhook perdido), `retention.purge` (90d) (depende T018)
- [ ] T021 [US2] **Validação (PORTÃO de cobrança)**: assinar em sandbox; reenviar webhook = sem efeito duplicado; assinatura inválida → `401`; trial → 1ª cobrança; `past_due`→carência→`unpaid` suspenso. (quickstart P3, P8) (depende T019, T020)

**Checkpoint**: SaaS cobrável (Básico/Intermediário) fim a fim. **MVP vendável = Fases 1–4.**

---

## Phase 4: User Story 3 - Limites e recursos por plano (Priority: P2)

**Goal**: limite de clientes e features por plano impostos no servidor (UI/API/MCP).

**Independent Test**: recurso fora do plano e limite de clientes bloqueados no servidor. (quickstart P4)

- [ ] T022 [US3] `tenancy/plan-gating.js`: `entitlements(org)`, `requirePlan(feature)`, `requireWithinLimit('clientes')` (depende T016)
- [ ] T023 [US3] Aplicar gating em REST, MCP e Gordon: criar cliente (limite), relatórios avançados, automações de funil, WhatsApp (VIP) (depende T022)
- [ ] T024 [US3] Contagem de clientes por org na criação (UI/API/MCP) com mensagem de upgrade (depende T022)
- [ ] T025 [P] [US3] Front: tela de **Planos/upgrade**; avisos de limite/recurso bloqueado (`upgrade:true`)
- [ ] T026 [US3] **Validação**: Básico tenta WhatsApp/relatório avançado → `403 upgrade`; limite de clientes → bloqueio; upgrade→VIP libera. (quickstart P4) (depende T023, T024)

**Checkpoint**: planos diferenciados e protegidos no servidor.

---

## Phase 5: User Story 4 - Agente por organização + Gordon (Priority: P2)

**Goal**: cada org emite chaves próprias (escopadas) e usa o assistente Gordon, que opera só os dados da
org.

**Independent Test**: chave da Org A no MCP só vê Org A; Gordon opera a org corrente; escrita auditada
`ia`+`org_id`. (quickstart P5)

- [ ] T027 [US4] Tela **Integrações** por org (`public/`, `server.js`): criar/revogar `api_keys` escopadas à org ativa (depende T010)
- [ ] T028 [US4] `ai/claude.js` (cliente Anthropic + cache de prompt + medição de tokens), `ai/router.js` (modelo por tarefa), `ai/usage.js` (`ai_usage` + teto por org) (depende T008)
- [ ] T029 [US4] `ai/tasks.js` → **Gordon**: chat que usa as ferramentas do CRM da org (via `crm-service`/MCP) sob os entitlements; escritas auditadas `ia`+`org_id` (depende T028, T009, T022)
- [ ] T030 [US4] `server.js` + front: endpoint e tela de **chat do Gordon** (depende T029)
- [ ] T031 [US4] **Validação**: chave da Org A não acessa Org B; Gordon opera só a org; revogação corta MCP em segundos. (quickstart P5) (depende T027, T030, T012)

**Checkpoint**: "cada cliente com o seu agente" + Gordon, isolados por org.

---

## Phase 6: User Story 5 - Conectar WhatsApp (VIP) (Priority: P3)

**Goal**: org VIP conecta uma linha (Evolution/Z-API) e recebe mensagens de leads no CRM.

**Independent Test**: conectar (sandbox), mensagem de lead → lead+mensagem na org (idempotente); não-VIP
bloqueado. (quickstart P6)

- [ ] T032 [US5] `whatsapp/provider.js` (interface) + `whatsapp/evolution.js` (adapter inicial) + `whatsapp/zapi.js` (adapter alternativo)
- [ ] T033 [US5] Conexão: `POST /api/whatsapp/connect|disconnect`, `GET /api/whatsapp/qr|status`; `whatsapp_connections` única por org; gating `requirePlan('whatsapp_ia')` (depende T032, T022)
- [ ] T034 [US5] `whatsapp/ingest.js` + `POST /webhooks/whatsapp/:provider`: verificar segredo da instância, identificar org, aceitar-e-enfileirar (depende T032)
- [ ] T035 [US5] Job `whatsapp.ingest`: `parseInbound`, idempotência `(org_id, provider_msg_id)`, associar/criar lead pelo telefone (respeita limite), enfileira IA (depende T034, T020, T024)
- [ ] T036 [P] [US5] Front: tela **Conectar WhatsApp** (QR/pareamento + status), só VIP
- [ ] T037 [US5] **Validação**: conectar e parear (sandbox); mensagem → lead+mensagem na Org; reenvio não duplica; não-VIP → `403`. (quickstart P6) (depende T033, T035)

**Checkpoint**: linha conectada e conversas entrando no CRM (VIP).

---

## Phase 7: User Story 6 - IA sobre conversas: resumo, sentimento, auto-atendimento (Priority: P3)

**Goal**: resumo + sentimento no histórico do lead; auto-atendimento opcional; modelo por tarefa; teto
por org.

**Independent Test**: resumo+sentimento aparecem; `sentimento`=Haiku, `resumo`=Sonnet; teto respeitado.
(quickstart P7)

- [ ] T038 [US6] Jobs `ai.sentiment` (Haiku) e `ai.summarize` (Sonnet) → `interacoes` (`tipo='sentimento'`/`'resumo_ia'`, `gerado_por_ia`) (depende T028, T035)
- [ ] T039 [US6] Orçamento por org: checagem antes de chamar; degradação (Opus→Sonnet→Haiku)/bloqueio; job `ai.usage_rollup` (depende T028)
- [ ] T040 [US6] (Fatia opcional) `ai.autoreply` (Sonnet→Opus) + `provider.sendMessage` + handoff + rate limit de envio (depende T038, T032)
- [ ] T041 [US6] **Validação**: resumo+sentimento no histórico; roteamento por tarefa em `ai_usage`; teto degrada/bloqueia sem estourar custo. (quickstart P7) (depende T038, T039)

**Checkpoint**: IA de topo (VIP) com custo governado.

---

## Phase 8: User Story 7 - Painel do operador (Priority: P3)

**Goal**: operador acompanha orgs/assinaturas/WhatsApp/uso de IA e age, com acesso separado e auditado.

**Independent Test**: operador vê tudo; usuário comum negado; ações auditadas. (quickstart P9)

- [ ] T042 [US7] `operator/`: consultas **cross-tenant explícitas** (fora do `withOrg` de tenant), restritas ao papel operador; toda ação grava `audit_log` (depende T008)
- [ ] T043 [US7] Painel do operador (lista de orgs com plano/status/WhatsApp/uso de IA; ações: suspender, ajustar plano) (depende T042)
- [ ] T044 [US7] **Validação**: operador lista orgs e uso; usuário comum negado; ação administrativa auditada. (quickstart P9) (depende T043)

**Checkpoint**: operação do SaaS instrumentada.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: contrato vivo, cutover final, segurança e produção.

- [ ] T045 [P] `openapi.yaml`: novos endpoints (conta/orgs, billing, whatsapp, ai/Gordon, operador)
- [ ] T046 [P] Docs: `README.md` (SaaS), `docs/SEGURANCA.md` (multi-tenant/RLS/PCI/webhooks), dicionário de dados, `docs/MCP.md` (MCP por org)
- [ ] T047 [P] LGPD por org: export/excluir cliente já cobertos; documentar retenção 90d e sub-processadores (Anthropic/pagar.me/provider)
- [ ] T048 **Cutover**: remover `better-sqlite3`; `Dockerfile` sem toolchain nativo de SQLite; confirmar app 100% em Postgres (depende T009, T013)
- [ ] T049 **Revisão de segurança** (Princípios II/IV/V/VI) antes de dados reais de múltiplos clientes: RLS (teste negativo), webhooks assinados+idempotentes, sem PAN, teto de IA, auditoria por org; registrar em `docs/SEGURANCA.md` (pode usar `/security-review` no diff)
- [ ] T050 Deploy: `docker-compose` (postgres + evolution + worker), webhooks no Traefik com TLS, `NODE_ENV=production`, backup do Postgres
- [ ] T051 Rodar [quickstart.md](quickstart.md) de ponta a ponta (Passos 1–10) como passe final de aceite

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — começa imediatamente.
- **Foundational (Phase 2)**: depende do Setup — **BLOQUEIA** todas as user stories; entrega US1.
- **User Stories (Phases 3–8)**: todas dependem da Foundational. Ordem por prioridade: US2 (P1) → US3/US4
  (P2) → US5/US6/US7 (P3). US5→US6 (IA precisa das conversas). US7 é independente.
- **Polish (Phase 9)**: depois das user stories desejadas; o **cutover (T048)** encerra a transição de
  SQLite.

### User Story Dependencies

- **US1 (Foundational)**: base de tudo (isolamento + contas + MCP por org).
- **US2 (P1)**: cobrança; habilita o gating real de US3.
- **US3 (P2)**: usa entitlements de US2.
- **US4 (P2)**: chaves por org (US1) + IA base (compartilhada com US6).
- **US5 (P3)**: VIP (gating US3) + fila (Setup).
- **US6 (P3)**: depende de US5 (conversas) + IA base de US4.
- **US7 (P3)**: cross-tenant sobre a Foundational; independente das demais.

### Parallel Opportunities

- **Setup**: T002, T003, T004 [P].
- **Foundational**: T014 (front) [P] em relação ao backend; T007 [P] após T005.
- **Telas de front** [P] entre si quando em arquivos próprios (T025, T036).
- **Polish**: T045, T046, T047 [P].
- Com time: após a Foundational, US2/US3/US4 podem correr em paralelo; US5/US6 em sequência.

---

## Implementation Strategy

### MVP First (cobrável)

1. Phase 1 Setup → Phase 2 Foundational (**PORTÃO de isolamento, T015**) → Phase 3 US2 (**PORTÃO de
   cobrança, T021**) → Phase 4 US3.
2. **PARAR e VALIDAR**: signup + isolamento + assinar plano + gating → SaaS Básico/Intermediário
   vendável.
3. Deploy/demo.

### Incremental Delivery

1. Foundational → isolamento provado.
2. + US2 → cobrança (MVP cobrável) → deploy.
3. + US3 → planos diferenciados.
4. + US4 → agente por org + Gordon.
5. + US5 → WhatsApp (VIP).
6. + US6 → IA sobre conversas (VIP).
7. + US7 → operador.
8. Polish + cutover + revisão de segurança + quickstart.

---

## Notes

- Sem testes automatizados (não solicitados); validação manual via [quickstart.md](quickstart.md).
- **Dois portões inegociáveis**: isolamento multi-tenant (T015) e idempotência/assinatura de webhook
  (T021) — antes de qualquer "concluído".
- O app de produção segue em SQLite até o **cutover (T048)**; a migração de dados é T013.
- `crm-service.js` é o ponto único que mantém REST, MCP e Gordon em paridade e a auditoria derivada da
  credencial (`ia`/`humano`) + `org_id`.
- Commit após cada tarefa ou grupo lógico; parar em qualquer checkpoint para validar a story.
