# Implementation Plan: SaaS Multi-Tenant — Planos, Cobrança, WhatsApp e IA

**Branch**: `002-saas-multitenant` | **Date**: 2026-06-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-saas-multitenant/spec.md`

## Summary

Transformar o Mini CRM de **dono único** em um **SaaS multi-tenant** sobre o mesmo processo Express,
mantendo o frontend vanilla. A fundação é **multi-tenancy com isolamento imposto no banco**:
PostgreSQL com **Row-Level Security** (toda tabela de domínio ganha `org_id`; a aplicação roda sob um
papel sujeito a RLS e define `app.current_org` por transação). Sobre essa base entram quatro blocos:
(1) **contas e assinatura** com auto-cadastro e cobrança recorrente via **pagar.me** (checkout +
webhooks assinados/idempotentes; permissões derivadas só do estado verificado); (2) **gating de
plano** (limite de clientes e features Básico/Intermediário/VIP impostos no servidor, em UI, API e
MCP); (3) **agente por organização** — chaves e servidor **MCP escopados à org** (estendendo a feature
001) e o assistente de chat **Gordon**; (4) no **VIP**, **WhatsApp** por trás de uma **abstração de
provider** (Evolution/Z-API), com ingestão de mensagens de leads e **IA Claude** sobre as conversas
(resumo, sentimento, auto-atendimento) **roteando o modelo por tarefa** (Haiku/Sonnet/Opus) e **medindo
o custo por organização**. Trabalho assíncrono (ingestão de WhatsApp, jobs de IA, reconciliação de
cobrança) usa uma **fila em Postgres** (`pg-boss`) — sem novo datastore. A lógica de domínio continua
em uma **camada de serviço compartilhada** por REST e MCP; a autoria de toda escrita permanece
**derivada da credencial** (`humano`/`ia`), agora carimbada com `org_id`.

## Technical Context

**Language/Version**: Node.js 20 LTS, JavaScript CommonJS (`type: commonjs`); módulos ESM (SDKs)
carregados por `import()` dinâmico, como já feito no MCP.

**Primary Dependencies**: Express 4 (existente); **`pg`** (PostgreSQL, NOVA) + **`node-pg-migrate`**
(migrações, NOVA); **`pg-boss`** (fila em Postgres, NOVA); **`@anthropic-ai/sdk`** (IA Claude, NOVA);
cliente HTTP nativo (`fetch`) para pagar.me e para os providers de WhatsApp (sem SDK pesado);
`@modelcontextprotocol/sdk` (existente, agora escopado por org); `helmet`, `express-rate-limit`,
`bcryptjs`, `cookie-parser`, `js-yaml`, `swagger-ui-express` (existentes). **Removida**:
`better-sqlite3` (substituída por `pg`).

**Storage**: **PostgreSQL** com **Row-Level Security** em toda tabela de tenant; migrações versionadas
em `migrations/`. `pg-boss` cria o seu próprio schema para a fila. A base SQLite atual é migrada
uma única vez para a organização inicial.

**Testing**: Verificação manual conforme `quickstart.md` (o projeto não adota framework de testes
automatizados; a constituição exige verificação manual antes de concluir). **Obrigatório**: teste
**negativo de isolamento** (uma org não acessa dados de outra) e teste de **idempotência de webhook**
(pagar.me e WhatsApp). Ambientes de **sandbox** do pagar.me e do provider de WhatsApp são usados.

**Target Platform**: Linux em container Docker atrás do Traefik (rede `web`), TLS terminado no proxy.
PostgreSQL como serviço/instância gerenciada. Webhooks expostos por HTTPS público via Traefik.
`NODE_ENV=production` ativa cookies `Secure` + HSTS.

**Project Type**: Web service de projeto único (backend Express + frontend estático em `public/`) com
um(ns) **worker(es)** de fila no mesmo código (processo separado ou mesmo processo, ver D11).

**Performance Goals**: SaaS de pequeno/médio porte. Alvo p95 < 500 ms para chamadas interativas
(UI/API/MCP). Webhooks respondidos rápido (aceitar e enfileirar). Jobs de IA são assíncronos; resumo de
conversa em ordem de segundos. Concorrência real existe (múltiplos webhooks/jobs de várias orgs).

**Constraints**: Isolamento multi-tenant imposto no banco (RLS); permissões só do estado de assinatura
verificado; nenhum dado de cartão no servidor; custo de IA medido e limitado por org; manter o frontend
vanilla; reutilizar a auth/auditoria existentes; mesmo deploy Traefik.

**Scale/Scope**: Dezenas a centenas de organizações inicialmente; milhares de clientes por org (VIP
ilimitado). 7 user stories; ~7 contratos/superfícies novas (tenancy, billing, whatsapp, ai, operador).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

> Avaliado contra a **Constitution v2.0.0** (emendada para esta feature: SaaS multi-tenant, PostgreSQL+
> RLS). A emenda em si está registrada na própria constituição (Sync Impact Report) e as mudanças de
> stack/serviços abaixo estão justificadas na **Complexity Tracking**.

| Princípio | Avaliação | Status |
|---|---|---|
| **I. Simplicidade Sob Medida** | Mesmo processo Express; frontend vanilla mantido; uma fila em Postgres (sem Redis); providers atrás de abstração mínima; sem framework de front. Novas dependências (`pg`, migrações, fila, SDK Anthropic) cada uma com problema concreto. | ✅ PASS |
| **II. Segurança/Privacidade (LGPD)** | Sem cartão no servidor (tokenização/checkout); webhooks assinados + idempotentes; segredos só como hash; `helmet`+rate limit em UI/API/MCP/webhooks; export/excluir por org; mínimo enviado à IA (sub-processador sem treino). | ✅ PASS |
| **III. Interface Dupla por Organização** | Chaves/MCP **escopados à org**; agente de uma org nunca vê outra; sessão (pessoa) separada de Bearer (máquina). | ✅ PASS |
| **IV. Auditoria Confiável** | `created_by`/`gerado_por_ia` derivado da credencial + `org_id` no registro; eventos sensíveis (plano, WhatsApp, exclusão, operador) auditados; chave registra último uso. | ✅ PASS |
| **V. Isolamento Multi-Tenant** | RLS em toda tabela de tenant; app sob papel sem `BYPASSRLS`; `app.current_org` por transação; padrão negar; cross-tenant só no operador, explícito e auditado. | ✅ PASS |
| **VI. Integridade de Cobrança** | Permissões derivam **só** do estado verificado (webhooks pagar.me) + reconciliação; limites/features impostos no servidor; política de inadimplência explícita. | ✅ PASS |
| **VII. Custo de IA Governado** | Modelo por tarefa (Haiku/Sonnet/Opus); cache de prompt e lote quando aplicável; medição + teto por org; IDs de modelo em config; sem gasto ilimitado. | ✅ PASS |
| **VIII. Documentação Viva** | `openapi.yaml` atualizado; contratos em `contracts/` (billing, whatsapp, ai, tenancy); README/segurança atualizados na implementação. | ✅ PASS |

**Restrições de stack (Seção 2 da constituição v2.0.0):** mantidas Node+Express, helmet, rate-limit,
env, Docker/Traefik. **Substituições/adições** (registradas na Complexity Tracking): SQLite→PostgreSQL+
RLS, `node-pg-migrate`, `pg-boss`, SDK Anthropic, abstração de WhatsApp, integração pagar.me.

**Re-avaliação pós-design (após Fase 1):** os artefatos de design não introduzem novas violações. A
camada de serviço compartilhada + RLS reforça os Princípios V e VIII; a derivação de permissões por
webhook verificado cumpre o VI; o roteamento por tarefa + medição cumpre o VII. **Constitution Check:
PASS (mantido).**

## Project Structure

### Documentation (this feature)

```text
specs/002-saas-multitenant/
├── plan.md              # Este arquivo (/speckit-plan)
├── research.md          # Fase 0 — decisões técnicas (D1..D12)
├── data-model.md        # Fase 1 — schema multi-tenant + políticas RLS
├── quickstart.md        # Fase 1 — guia de validação manual ponta a ponta (sandbox)
├── contracts/
│   ├── tenancy-auth.md      # Contas, membership, organização ativa, RLS, gating
│   ├── billing-pagarme.md   # Checkout, assinatura, webhooks, estados, inadimplência
│   ├── whatsapp-provider.md # Interface de provider + adapters Evolution/Z-API + webhook
│   └── ai-routing.md        # Roteamento Claude por tarefa, resumo/sentimento/auto, custo
├── checklists/
│   └── requirements.md  # Checklist de qualidade do spec
└── tasks.md             # Fase 2 — (/speckit-tasks, NÃO criado aqui)
```

### Source Code (repository root)

```text
saas-mentoria/
├── server.js                 # ALTERADO: bootstrap async; rotas de auth/conta/billing/whatsapp; webhooks; monta /mcp por org
├── db.js                     # REESCRITO: pool `pg`; helper de transação que aplica SET LOCAL app.current_org (RLS)
├── auth.js                   # ALTERADO: sessão/chave carregam org_id + papel; resolverPrincipal por org; signup
├── crm-service.js            # ALTERADO: operações recebem o contexto de org (todas as queries via helper RLS)
├── migrations/               # NOVO: migrações node-pg-migrate (schema multi-tenant, RLS, billing, whatsapp, ai)
│   └── NNNN_*.js
├── tenancy/                  # NOVO: organização, membership, organização ativa, middleware de gating de plano
│   ├── orgs.js               #   criar org no signup, papéis, troca de org ativa
│   └── plan-gating.js        #   requirePlan(feature) / requireWithinLimit('clientes'); entitlements por plano
├── billing/                  # NOVO: integração pagar.me
│   ├── pagarme.js            #   cliente HTTP (assinaturas/planos/clientes)
│   ├── webhooks.js           #   verificação de assinatura + idempotência + mapeamento de estado
│   └── plans.js              #   catálogo de planos (preço, limite, features) — fonte de verdade local
├── whatsapp/                 # NOVO: abstração de provider + ingestão
│   ├── provider.js           #   interface WhatsAppProvider (createInstance, qrCode, sendMessage, parseInbound...)
│   ├── evolution.js          #   adapter Evolution API
│   ├── zapi.js               #   adapter Z-API
│   └── ingest.js             #   webhook inbound → normaliza → lead/mensagem → enfileira jobs de IA
├── ai/                       # NOVO: IA Claude
│   ├── claude.js             #   cliente Anthropic + cache de prompt + contagem/medição de tokens
│   ├── router.js             #   escolha de modelo por tarefa (Haiku/Sonnet/Opus) + escalonamento
│   ├── tasks.js              #   resumo, sentimento, auto-atendimento, Gordon (prompts por tarefa)
│   └── usage.js              #   medição e teto por organização (ai_usage)
├── jobs/                     # NOVO: fila pg-boss
│   ├── queue.js              #   setup pg-boss + registro de handlers
│   └── worker.js             #   ponto de entrada do worker (mesmo código, processo dedicado)
├── mcp/                      # ALTERADO: server.mjs/tools.mjs recebem o contexto de org da credencial
├── operator/                 # NOVO: painel do operador (consultas cross-tenant explícitas e auditadas)
├── public/                   # ALTERADO: signup, billing/plano, conectar WhatsApp (QR), Gordon (chat), relatórios
├── scripts/
│   └── migrate-sqlite-to-pg.js  # NOVO: migração única da base de dono único → organização inicial
├── openapi.yaml              # ALTERADO: novos endpoints (conta, billing, whatsapp, ai, operador)
├── docs/                     # ATUALIZADO: páginas de SaaS, billing, WhatsApp, IA, segurança multi-tenant
├── Dockerfile                # ALTERADO: sem toolchain nativo de SQLite; build do `pg`
├── docker-compose.yml        # ALTERADO: serviços postgres + evolution (provider inicial); rotas de webhook no Traefik; worker
└── package.json              # ALTERADO: +pg, +node-pg-migrate, +pg-boss, +@anthropic-ai/sdk; -better-sqlite3
```

**Structure Decision**: Projeto único, mesmo processo Express para a parte interativa (UI/API/MCP/
webhooks), com um **worker** de fila (`jobs/worker.js`) no mesmo código-base rodando como processo
dedicado (escala e isola o trabalho assíncrono). A lógica de domínio permanece em `crm-service.js`
(agora recebendo o contexto de organização), de modo que REST, MCP e Gordon compartilhem exatamente o
mesmo comportamento, validação e auditoria (Princípio VIII). As integrações externas ficam em módulos
isolados (`billing/`, `whatsapp/`, `ai/`) atrás de interfaces, e o isolamento de tenant é imposto no
banco (RLS) por um helper de transação em `db.js`.

## Complexity Tracking

> Itens que adicionam partes móveis frente à v1; cada um com a alternativa simples rejeitada. A troca
> de SQLite→PostgreSQL já está ratificada na constituição v2.0.0 (Princípio V + Seção de Stack); aqui
> registramos o porquê e os serviços que a acompanham.

| Violation / Adição | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **PostgreSQL + RLS** (substitui SQLite) | Isolamento multi-tenant imposto no banco (defesa em profundidade, LGPD com muitos titulares) + concorrência real de webhooks/jobs de várias orgs. | SQLite single-file: isolamento só na aplicação (1 bug vaza tudo) e escritor único vira gargalo sob webhooks/jobs concorrentes. SQLite por tenant: complica backup, migração e consultas do operador. |
| **`pg-boss` (fila em Postgres)** | Ingestão de WhatsApp e jobs de IA precisam ser assíncronos, com retry/idempotência, sem bloquear webhooks. | Processar inline no request: webhooks lentos/perdidos e acoplamento; cron caseiro: sem retry/visibilidade. Redis/BullMQ: adiciona um datastore — adiado até a escala exigir. |
| **SDK Anthropic + roteador de modelos** | Resumo/sentimento/auto-atendimento e Gordon; custo controlado exige escolher modelo por tarefa e medir. | Um único modelo para tudo: ou caro (Opus em tarefa trivial) ou fraco (Haiku em tarefa complexa); chamada HTTP crua: reimplementaria streaming/cache/erros. |
| **Abstração de WhatsApp (2 adapters)** | Requisito do usuário (Evolution **ou** Z-API) e evitar lock-in de uma API não oficial sujeita a mudança/ban. | Acoplar a um provider: retrabalho ao trocar; suportar os dois sem interface: lógica duplicada e divergente. |
| **Integração pagar.me + webhooks** | Receita recorrente; permissões derivadas de estado verificado. | "Confiar no front" para liberar plano: quebra o Princípio VI (receita/justiça entre planos). |
| **Worker dedicado de fila** | Isola o trabalho assíncrono do caminho interativo e permite escalar. | Tudo no processo web: picos de IA/ingestão degradam a UI/API. |

## Phasing (resumo; o detalhamento vai para tasks.md em /speckit-tasks)

> As user stories são entregáveis e testáveis de forma independente. A ordem respeita as dependências:
> a **Fundação multi-tenant** bloqueia todas; cobrança e gating vêm em seguida; WhatsApp/IA (VIP) por
> último. Cada fase tem um checkpoint de validação manual (quickstart) e o portão de isolamento.

- **Fase 0 — Setup & dependências**: adicionar `pg`, `node-pg-migrate`, `pg-boss`, `@anthropic-ai/sdk`;
  remover `better-sqlite3`; subir Postgres local; esqueleto de pastas (`tenancy/ billing/ whatsapp/ ai/
  jobs/ operator/`); compose com serviço postgres.
- **Fase 1 — Fundação multi-tenant (BLOQUEIA tudo)** [US1]: migrações com `org_id` + **RLS** em todas as
  tabelas (clientes, interacoes, api_keys) e novas (organizations, users, memberships); helper de
  transação RLS em `db.js`; `crm-service.js` recebendo o contexto de org; auth com signup + organização
  ativa; **MCP escopado por org**; migração da base SQLite → organização inicial. **Portão**: teste
  negativo de isolamento.
- **Fase 2 — Cobrança (pagar.me)** [US2]: catálogo de planos local; checkout/assinatura **com trial de
  14 dias (somente cartão)**; **webhooks assinados + idempotentes**; máquina de estados
  (trial/ativa/carência/suspensa/cancelada) + **retenção de 90 dias**; reconciliação. **Portão**:
  idempotência + estado→permissão.
- **Fase 3 — Gating de plano** [US3]: entitlements por plano; `requirePlan`/`requireWithinLimit` em UI,
  API e MCP; limite de clientes; telas de plano/upgrade.
- **Fase 4 — Agente por organização + Gordon** [US4]: chaves por org na UI; Gordon (chat) usando a
  camada de serviço/MCP da org; auditoria `ia`+`org_id`.
- **Fase 5 — WhatsApp (VIP)** [US5]: interface de provider + adapters Evolution/Z-API; conectar/parear
  (QR), estado, uma linha por org; webhook inbound → lead/mensagem (idempotente) → enfileira.
- **Fase 6 — IA sobre conversas (VIP)** [US6]: roteador de modelos; resumo + sentimento (jobs);
  medição/teto por org; auto-atendimento com handoff (fatia opcional).
- **Fase 7 — Painel do operador** [US7]: consultas cross-tenant explícitas/auditadas; ações
  administrativas.
- **Fase 8 — Polish & produção**: `openapi.yaml`, docs (README/SEGURANCA/MCP/dicionário), revisão de
  segurança multi-tenant (Princípios II/IV/V/VI) antes de dados reais, deploy (Traefik + Postgres +
  worker), quickstart de ponta a ponta.

**MVP recomendado**: Fases 0–3 (SaaS cobrável com isolamento e gating) — já é um produto vendável;
Básico/Intermediário funcionam fim a fim. VIP (WhatsApp + IA, Fases 5–6) é o incremento seguinte.
