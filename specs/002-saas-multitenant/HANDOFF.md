# Handoff — SaaS Multi-Tenant (feature 002)

**Data:** 2026-06-07 · **Branch:** `002-saas-multitenant` (8 commits, **não publicada/sem push**) ·
**Working tree:** limpo · **Autor dos commits:** Fernando Melo Faraco <farakeys@gmail.com>

> Documento de continuidade. Lê isto primeiro, depois `plan.md`, `tasks.md` e `data-model.md`.

---

## 🟢 TL;DR

O Mini CRM (dono único, SQLite) foi transformado em **SaaS multi-tenant em produção**: PostgreSQL +
**RLS**, signup/trial, **cobrança + gating de plano**, **IA Claude (Gordon + sentimento/resumo)** e
**WhatsApp VIP** (bring-your-own por org). Cada fase foi **verificada** antes de subir (scripts
`scripts/verify-*.js` + smokes em produção). Roda em `https://mentoria.saas.better-knowledge.com`
(container `saas-mentoria`), com o app antigo `crm-mentoria` intacto como fallback.

## ✅ BLOQUEADOR RESOLVIDO (2026-06-07, sessão de continuação) — era roteamento Traefik, não DNS

**O diagnóstico anterior estava errado.** O DNS de `mentoria.saas.better-knowledge.com` resolve para
**72.62.9.198**, que **é este host** (onde rodam Traefik + apps). Não havia nada a corrigir no DNS — o
IP `145.223.29.66` é de **outro** host (para onde aponta `mentoria.crm.better-knowledge.com`, irrelevante:
o CRM local serve `mentoria.crm.fernandofaraco.me`).

**Causa raiz real:** o Traefik está configurado **somente com o provider `file`** (`/etc/traefik/traefik.yml`
→ `providers.file`, dir `/etc/traefik/dynamic`). **Não há provider `docker`**, então as *labels* Traefik no
`docker-compose` (do `saas-mentoria` e até do `crm-mentoria`) **nunca são lidas**. Sem um arquivo de
roteamento, o Traefik servia o `TRAEFIK DEFAULT CERT` e o Let's Encrypt nunca era acionado.

**Correção aplicada:** criado `/opt/docker-services/traefik/dynamic/saas-mentoria.yml` (no host, espelhando
o `crm-mentoria.yml`): router `Host(mentoria.saas...)` → service `http://saas-mentoria:3000`, middleware
`secure-headers`, `certResolver: letsencrypt`. Traefik observa o dir (`watch: true`) e emitiu o cert via
HTTP-01 em ~10s. **Estado atual:** `https://mentoria.saas.better-knowledge.com/` → HTTP 200, cert válido
Let's Encrypt (CN=mentoria.saas..., válido até 2026-09-05), redirect 301 HTTP→HTTPS ativo.

**Próximo (ação do usuário):** agora que o cert é válido, a Evolution deve aceitar os webhooks. Mandar um
WhatsApp ao número conectado (`oFernandoFaraco`) → deve surgir um lead "WhatsApp" + sentimento por IA.
Se não chegar, conferir a URL do webhook na instância da Evolution (deve apontar p/ `https://mentoria.saas.../...`).

> ⚠️ Nota de infra: as labels Traefik no `docker-compose.yml` deste repo são **decorativas** (não há provider
> docker). Qualquer host/router novo precisa de um arquivo em `/opt/docker-services/traefik/dynamic/`.

---

## Topologia de produção

- **Servidor:** este host (145.223.29.66). Docker + Traefik (rede externa `web`).
- **App novo:** dir `/opt/docker-services/saas-mentoria` (este repo). Compose project `saas-mentoria`:
  containers `saas-mentoria` (app, host `mentoria.saas.better-knowledge.com`), `saas-mentoria-pg`
  (Postgres 16). `saas-mentoria-worker` e `saas-mentoria-evolution` existem no compose mas **não são
  iniciados** (fases futuras / Evolution é bring-your-own, não usamos a do compose).
- **App antigo (fallback, intocado):** dir `/opt/docker-services/crm-mentoria`, container `crm-mentoria`,
  host `mentoria.crm.better-knowledge.com` (SQLite, v1). As duas stacks coexistem (nomes/hosts distintos).
- **Banco:** Postgres com **RLS**. App conecta como `app_login` (LOGIN, membro de `app_role`, **sem
  BYPASSRLS**). Migrações/admin usam o superuser `postgres`. Isolamento por org imposto no banco.

## Status por fase (✅ no ar e verificado)

| Fase | Commit | O que entrega |
|---|---|---|
| Constituição v2.0.0 | `4608dc8` | dono único→multi-tenant; SQLite→Postgres+RLS; +Isolamento/Cobrança/Custo de IA |
| Spec + plano (artefatos) | `d2de9d3` | `specs/002-saas-multitenant/` (spec/plan/research/data-model/contracts/quickstart/tasks) |
| 1–2 Fundação + **cutover** | `edc2944`, `fb8f223` | Postgres+RLS, `withOrg`, signup/org ativa, MCP por org, app 100% em PG |
| 3–4 Cobrança + gating | `198bc58` | planos, **trial 14d**, webhooks assinados+idempotentes, entitlements, limite de clientes |
| 5 + núcleo 7 IA | `124aec5` | **Gordon** (`/api/gordon`), roteamento por tarefa (Haiku/Sonnet/Opus), custo medido (`ai_usage`) |
| 6 WhatsApp VIP | `2924b77`, `0f4439a` | provider por org (Evolution), creds cifradas, conexão, **ingestão→lead→IA** |

**Verificações:** RLS 7/7, cutover 9/9, billing 10/10, IA 8/8 + smoke real (Gordon via Sonnet),
WhatsApp 8/8 + pipeline inbound real (lead+mensagem+sentimento "positivo" via Haiku).

**WhatsApp já conectado:** a org "Minha empresa" tem `whatsapp_connections.instance_ref =
oFernandoFaraco` (linha real do dono, `estado=conectado`, webhook apontado ao CRM). Só não recebe
mensagens por causa do bloqueador de DNS acima.

## ⏳ Pendências (prioridade)

1. ~~**DNS/cert** (bloqueador acima)~~ ✅ **RESOLVIDO** (roteamento file provider; HTTPS público ok). Resta o
   teste ao vivo do WhatsApp (ação do usuário: mandar mensagem ao número conectado).
2. ~~**Auto-atendimento de IA**~~ ✅ **ENTREGUE (2026-06-08, migração 0004)** — "IA por Lead":
   - **Config por Lead** (`clientes.ai_config` jsonb): `auto_sentimento` (default on) e `auto_resposta`
     (opt-in VIP) liga/desliga por Lead. O sentimento deixou de ser fixo no inbound.
   - **Auto-resposta autônoma** (`whatsapp/auto-reply.js`): envia via `provider.sendMessage`, com **rate
     limit** por Lead (default 5/10min) e **handoff p/ humano** (pedido explícito de humano por keyword,
     sentimento negativo, ou IA sinalizando `[HANDOFF]`) — no handoff desliga `auto_resposta` e grava nota.
   - **Documentos de contexto do Lead** (`lead_documents`, RLS): transcrição/resumo/documento/proposta.
     Ações sob demanda em `POST /api/clientes/:id/ai/acao` (gated `whatsapp_ia` + orçamento de IA).
   - **UI mínima** na ficha do Lead (`public/app.js`): toggles, botões de ação e lista de documentos.
     (Obs.: corrigido bug v1 — `onclick="abrirFicha(${id})"` quebrava com ids uuid; agora com aspas.)
   - Verificado: `scripts/verify-ia-lead.js` **14/14** + RLS **7/7** (Postgres descartável) + smoke real
     em prod (resumo gerado pelo Claude e persistido). Novos endpoints: `GET/PUT .../ai-config`,
     `GET/POST/DELETE .../documentos`, `POST .../ai/acao`.
   - **Pendente menor:** resumo/documento ainda não são disparados por *threshold* automático (são sob
     demanda); a auto-resposta roda síncrona no webhook (mover p/ fila se virar gargalo).
3. ~~**Painel do operador**~~ ✅ **ENTREGUE (2026-06-08, migração 0005)** — Fase 8, **somente leitura,
   métricas agregadas** (decisão do usuário; NÃO acessa o conteúdo dos CRMs). Papel global
   `usuarios.is_operator` (auth `requireOperator`; `ensureOperator()` no boot promove `OPERATOR_EMAIL`||
   `ADMIN_EMAIL` → farakeys@gmail.com já é operador em prod). `operator/service.js`: overview/listarOrgs/
   detalheOrg — tabelas de plataforma sem RLS lidas direto; métricas de tenant (clientes, ai_usage) lidas
   **por org via `withOrg`** (RLS preservado, app continua sem BYPASSRLS); **toda ação grava `audit_log`**
   (ator_tipo='operador', org_id NULL). Rotas `GET /api/operator/{overview,orgs,orgs/:id}`. UI: aba
   "Operador" no front (visível só p/ operador). Verificado: `scripts/verify-operator.js` **14/14**
   (rodado como `app_login` p/ provar o isolamento por org) + smoke real em prod. **A fazer depois:**
   ações de gestão (suspender/comp/trocar plano) — hoje é read-only.
4. **pagar.me ao vivo** (mockado por decisão do usuário): preencher `PAGARME_API_KEY` +
   `PAGARME_WEBHOOK_SECRET`, criar planos no painel pagar.me e completar `billing/pagarme.js` (rotas
   `subscribe`/`change-plan` pago/`cancel` hoje devolvem 503/501). **Confirmar a forma de assinatura do
   webhook do pagar.me** (o `verificarWebhook` usa HMAC-SHA256 genérico — ajustar ao header real).
5. **Front (telas)**: backend pronto, mas `public/` ainda são as telas v1. Faltam: signup, planos/
   upgrade/checkout, conectar WhatsApp (campos base_url+api_key+instance, QR), chat do Gordon, troca de
   org. Gating já devolve erros (`upgrade:true`/`billing:true`/402) que a UI pode tratar.
6. **Limpeza (T048)**: `better-sqlite3` ainda em `package.json` mas **não é mais usado** — remover e
   simplificar o `Dockerfile` (sem toolchain nativo).
7. **Z-API**: `whatsapp/zapi.js` é stub (provider inicial é Evolution).
8. **Revisão de segurança multi-tenant** antes de dados reais de muitos clientes (Princípios II/IV/V/VI):
   rodar `/security-review` no diff; conferir RLS (teste negativo), webhooks, sem PAN, teto de IA.

## Credenciais / `.env` (em `/opt/docker-services/saas-mentoria/.env`, chmod 600, fora do git)

| Var | Estado |
|---|---|
| `DATABASE_URL` | app_login@postgres (definida) |
| `POSTGRES_PASSWORD` / `APP_DB_PASSWORD` | gerados (definidos) |
| `ADMIN_EMAIL` / `ADMIN_SENHA` | farakeys@gmail.com / (a senha do deploy antigo, reutilizada) → owner da org "Minha empresa" (VIP/active comp'd) |
| `ANTHROPIC_API_KEY` | **definida** (Gordon/IA funcionam) |
| `CLAUDE_MODEL_*` | claude-haiku-4-5 / claude-sonnet-4-6 / claude-opus-4-8 |
| `EVOLUTION_URL` | `https://evo2.better-knowledge.com/` (v2.3.7) |
| `EVOLUTION_API_KEY` | **definida, porém instance-scoped** (lê/opera, **NÃO cria** instâncias — criar exige a *global* key da Evolution) |
| `ENCRYPTION_KEY` | definida (cifra creds de WhatsApp por org, AES-256-GCM) |
| `PAGARME_API_KEY` / `PAGARME_WEBHOOK_SECRET` | **vazias** (cobrança mockada: rotas 503/501) |
| `APP_URL` | `https://mentoria.saas.better-knowledge.com` |

## Padrões de desenvolvimento / verificação / deploy

- **Verificar lógica sem tocar prod** (Postgres descartável): há `scripts/verify-rls.js`,
  `verify-cutover.js`, `verify-billing.js`, `verify-ai.js`, `verify-whatsapp.js`. Padrão usado nesta
  sessão: subir `postgres:16` numa rede docker temporária, `npm install pg node-pg-migrate bcryptjs`
  num container `node:20`, aplicar migrações como superuser, criar `app_login` (`CREATE ROLE app_login
  LOGIN PASSWORD '...' IN ROLE app_role`), rodar os verify-*.js como `app_login` (RLS ativa). Sempre
  validar contra Postgres descartável antes de subir.
- **Deploy (no host):**
  ```bash
  cd /opt/docker-services/saas-mentoria
  PGPW=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
  docker compose up -d --build app                                   # rebuild + recria o app
  docker compose run --rm -e DATABASE_URL="postgres://postgres:$PGPW@postgres:5432/saas" \
    app npx node-pg-migrate up -m migrations                          # migrações (superuser)
  docker compose logs app | tail
  ```
  Migrações aplicadas: `0001` (schema+RLS+planos), `0002` (custo_micro_usd + orçamento de IA),
  `0003` (creds WhatsApp por org).
- **Provisionar app_login (uma vez por banco):** `docker compose exec postgres psql -U postgres -d saas
  -c "DO $$ BEGIN IF NOT EXISTS (...) THEN CREATE ROLE app_login LOGIN PASSWORD '<APP_DB_PASSWORD>' IN
  ROLE app_role; ... END $$;"`.
- **Bootstrap:** no 1º boot com banco vazio, `auth.bootstrapInicial()` cria a org inicial + admin do
  `.env`; `ensureSubscriptions()` faz backfill de assinatura trial. A org do operador foi **comp'd**
  para VIP/active manualmente (UPDATE em `subscriptions`).
- **Commit:** mensagens em PT-BR, terminando com `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
  Nada de push sem o usuário pedir.

## Mapa de arquivos (novos/alterados nesta feature)

```
db.js                      pool pg + withOrg/withoutOrg (SET LOCAL app.current_org) — RLS
crm-service.js             async, recebe `client`; INSERT org_id=current_setting; impõe limite de clientes
auth.js                    signup (usuario+org+membership+assinatura trial), sessão c/ org_ativa, chaves por org, bootstrap
server.js                  rotas REST/MCP/billing/whatsapp/gordon + webhooks; comOrg(); handler de erro (502/503 expõe msg)
mcp/server.mjs, tools.mjs  ferramentas rodam em withOrg(org_id); id de cliente é uuid
migrations/000{1,2,3}_*.js schema multi-tenant + RLS; IA custo/orçamento; creds WhatsApp por org
billing/{plans,state,pagarme}.js  entitlements; máquina de estados via webhook (idempotente); cliente pagar.me (stub p/ live)
tenancy/plan-gating.js     requireAccess (suspensão→402) + requirePlan(feature)
ai/{router,pricing,claude,usage,tasks}.js  modelo por tarefa; custo micro-USD; cliente Anthropic; teto por org; Gordon/sentimento/resumo
whatsapp/{provider,evolution,zapi,connections,ingest}.js  abstração; adapter Evolution v2.3.7; creds por org (cifradas); ingestão→lead→IA
lib/secrets.js             AES-256-GCM (ENCRYPTION_KEY) p/ segredos por org
operator/                  VAZIO (Fase 8 a fazer)
scripts/verify-*.js + migrate-sqlite-to-pg.js (não usado: bootstrap-from-env cobriu o prod quase vazio)
```

## Caveats / armadilhas conhecidas

- **api_keys, whatsapp_connections, audit_log NÃO têm RLS** (são auth/lookup global — chave por hash,
  instância por instance_ref); isolados por `org_id` na aplicação. Tabelas de tenant com RLS:
  `clientes`, `interacoes`, `whatsapp_messages`, `ai_usage`.
- **Evolution criar instância exige a *global* key**; a key do usuário é instance-scoped. Para orgs que
  já têm instância, o `connect` usa a existente (passar `instance_ref`) e só faz `setWebhook`. Caminhos
  da Evolution conferidos contra a **v2.3.7** real do usuário (evo2).
- **Conectar WhatsApp aponta o webhook da linha real ao CRM** — ação outward-facing; pedir
  consentimento antes (foi feito p/ a `oFernandoFaraco`).
- **Custo de IA** em `ai_usage.custo_micro_usd` (micro-USD = USD×1e6); orçamento por plano em
  `plans.features.ai_budget_micro_usd`. `custo_centavos` é legado.
- **pagar.me**: o `verificarWebhook` HMAC é um palpite — confirmar o esquema real do painel pagar.me.

## Playbook de continuação (sugerido)

1. **Usuário corrige o DNS** (A → 145.223.29.66) → eu valido cert + teste ao vivo do WhatsApp.
2. **Painel do operador (Fase 8)** — não precisa de credencial externa; bom próximo passo.
3. **Auto-atendimento** (`ai.auto_resposta` + sendMessage + handoff) — depende do WhatsApp ao vivo.
4. **Telas de front** (signup/planos/WhatsApp/Gordon).
5. **pagar.me ao vivo** quando houver chaves.
6. **Cutover final (T048)** + revisão de segurança + `/speckit-tasks` para reabrir tasks.md se quiser.
