# Quickstart — Validar o SaaS Multi-Tenant (Planos, Cobrança, WhatsApp, IA)

**Feature**: `002-saas-multitenant` · **Date**: 2026-06-07

Guia de validação manual ponta a ponta. Prova: **isolamento entre organizações**, **cobrança e gating
por plano**, **agente por org (MCP) + Gordon**, **WhatsApp (VIP)** e **IA com custo governado**. (O
projeto não usa framework de testes — a constituição exige verificação manual antes de concluir.) Usa
os **sandboxes** do pagar.me e do provider de WhatsApp.

## Pré-requisitos

- Node.js 20 LTS; dependências instaladas (`pg`, `node-pg-migrate`, `pg-boss`, `@anthropic-ai/sdk`).
- **PostgreSQL** no ar; papel da aplicação **sem `BYPASSRLS`**; `DATABASE_URL` no `.env`.
- Migrações aplicadas (`npm run migrate up`) e catálogo de planos populado.
- `.env`: `PAGARME_API_KEY`/`PAGARME_WEBHOOK_SECRET` (sandbox), `ANTHROPIC_API_KEY`,
  `WHATSAPP_PROVIDER` + credenciais do provider (sandbox), `APP_URL`.
- App no ar (`npm start`) e **worker** no ar (`npm run worker`). Para receber webhooks locais, um túnel
  HTTPS (ex.: o domínio de homologação atrás do Traefik) apontando para `/webhooks/*`.

## Passo 1 — Auto-cadastro e organização (US1 / FR-001)

1. Em `/`, **Criar conta**: nome, e-mail, senha, nome da organização.
2. **Esperado**: login automático; CRM vazio; `GET /api/auth/me` retorna `org_ativa` e `papel='owner'`.
3. Crie uma **segunda** conta (outro e-mail) → outra organização (Org B), para o teste de isolamento.

## Passo 2 — Isolamento entre organizações (US1 / FR-004 / SC-001) 🔒 portão

1. Na Org A, crie um cliente "Lead A"; anote o `id` retornado.
2. Faça login na Org B (outra aba/navegador). Tente abrir o `id` do "Lead A":
   ```bash
   curl -i http://localhost:3000/api/clientes/<ID_DO_LEAD_A> \
     -H "Cookie: <sessão da Org B>"
   ```
3. **Esperado**: `404 Não encontrado` (o RLS faz a linha "não existir"); `GET /api/clientes` na Org B
   **não** lista o Lead A. Repita o mesmo teste via **MCP** com a chave da Org B → também negado.
4. **Teste de DB** (opcional, prova do RLS): conectado com o papel da aplicação, sem
   `app.current_org`, `SELECT * FROM clientes` retorna **0 linhas**.

## Passo 3 — Assinar um plano (US2 / FR-006..009 / SC-003)

1. Na Org A, abra **Planos**; escolha **Básico**; conclua o checkout do **pagar.me sandbox** (cartão de
   teste / tokenização no cliente).
2. Simule a confirmação: dispare/aguarde o webhook `subscription.created`/`invoice.paid`.
3. **Esperado**: `GET /api/billing` mostra plano **Básico** `active` com período vigente; `GET
   /api/auth/me` reflete os `entitlements` do Básico. Reenvie o **mesmo** webhook → **sem efeito
   duplicado** (idempotência; confira `billing_events`).
4. Envie um webhook com **assinatura inválida** → `401`, sem efeito (SC-008).

## Passo 4 — Gating de plano e limite de clientes (US3 / FR-012/013 / SC-004)

1. Org A no **Básico**: tente **conectar WhatsApp** → `403 upgrade:true` (recurso VIP). Tente
   relatórios avançados → bloqueado.
2. Limite de clientes: ajuste o `limite_clientes` do Básico para um valor baixo no sandbox (ex.: 3),
   crie até o limite; o próximo (UI **e** API/MCP) → `403 "Limite de clientes do plano atingido"`.
3. Faça **upgrade** para **VIP** (`change-plan` + webhook). **Esperado**: WhatsApp e relatórios
   avançados passam a ser permitidos; limite vira ilimitado.

## Passo 5 — Agente por organização (chave/MCP) + Gordon (US4 / FR-014..016 / SC-005)

1. Na Org A (**Integrações**), gere uma **chave de API** (mostrada uma vez).
2. Use a chave no MCP e confirme que só vê dados da Org A:
   ```bash
   curl -s -X POST http://localhost:3000/mcp \
     -H "Authorization: Bearer $CHAVE_ORG_A" \
     -H "Content-Type: application/json" -H "Accept: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"listar_clientes","arguments":{}}}'
   ```
   **Esperado**: apenas clientes da Org A. A chave da Org A **não** acessa dados da Org B.
3. Abra o **Gordon** (chat) na Org A; peça "liste meus follow-ups de hoje" e "crie um lead X".
   **Esperado**: o Gordon opera o CRM **da Org A**; a escrita fica `created_by='ia'` com o `org_id` da
   Org A. Revogue a chave → próxima chamada MCP `401` em segundos.

## Passo 6 — Conectar WhatsApp (VIP) (US5 / FR-017..019 / SC-006)

1. Org A (**VIP**) → **Conectar WhatsApp**: `POST /api/whatsapp/connect`; abra o **QR/código** (`GET
   /api/whatsapp/qr`) e pareie no sandbox do provider.
2. **Esperado**: `GET /api/whatsapp/status` → `conectado`; `whatsapp_connections` única por org.
3. Envie uma **mensagem de entrada** (do sandbox/segundo número) para a linha.
   **Esperado**: o webhook `POST /webhooks/whatsapp/:provider` é aceito; um **lead** é criado/associado
   pelo telefone e a **mensagem** é registrada na Org A. Reenvie a mesma mensagem (mesmo
   `provider_msg_id`) → **sem duplicar** (idempotência).
4. Org B (não-VIP) tentando conectar → `403 upgrade:true`.

## Passo 7 — IA sobre conversas: resumo, sentimento, custo (US6 / FR-021..025 / SC-007)

1. Com mensagens registradas na Org A, dispare/aguarde os jobs `ai.sentiment` e `ai.summarize`.
   **Esperado**: uma `interacao` `tipo='sentimento'` (rótulo) e uma `tipo='resumo_ia'` aparecem no
   histórico do lead, marcadas como IA.
2. Confira `ai_usage`: a tarefa **`sentimento`** usou **Haiku**; **`resumo`** usou **Sonnet**
   (roteamento por tarefa). Os custos foram contabilizados por org.
3. (Opcional) ative o **auto-atendimento**; envie uma mensagem de lead → uma resposta de IA é enviada
   pela linha e registrada (`gerado_por_ia=true`), com regra de **handoff**.
4. **Teto de IA**: rebaixe o orçamento do plano no sandbox; ao atingir, novas chamadas **degradam**
   (modelo menor) ou **bloqueiam** com aviso — **sem estourar custo**.

## Passo 8 — Inadimplência e cancelamento (US2 / FR-010)

1. Simule `invoice.payment_failed` → `subscriptions.status='past_due'` (carência); acesso mantido até
   `grace_until`.
2. Avance a carência (job/relógio) → `unpaid` → **suspenso**: escritas `402 billing:true`; leitura e
   **export LGPD** continuam.
3. `subscription.canceled` → suspenso; novo pagamento → volta a `active`.

## Passo 9 — Painel do operador (US7 / FR-026/028 / SC-009)

1. Como **operador**, abra o painel: lista de orgs com plano, status, WhatsApp e consumo de IA.
2. Um usuário comum de org tentando acessar o painel → negado.
3. Suspenda uma org pelo painel → aplicada e **auditada** (`audit_log`). Confirme que a consulta
   cross-tenant do operador é a única que cruza tenants.

## Passo 10 — LGPD por organização (FR-027)

1. Na Org A, **exportar** um cliente → JSON com ficha + interações + mensagens de WhatsApp.
2. **Excluir** um cliente (LGPD) → some das leituras; ação auditada. Confirme que nada disso toca a
   Org B.

## Critérios de aceite cobertos

| Passo | Cobre |
|---|---|
| 1 | FR-001 |
| 2 | FR-004, SC-001 (portão de isolamento) |
| 3 | FR-006..009, SC-003, SC-008 |
| 4 | FR-012/013, SC-004 |
| 5 | FR-014..016, SC-005 |
| 6 | FR-017..019, SC-006 |
| 7 | FR-021..025, SC-007 |
| 8 | FR-010 |
| 9 | FR-026/028, SC-009 |
| 10 | FR-027 |
| produção | FR-007 (sem PAN), FR-029 (helmet/rate limit/segredos), FR-011 (reconciliação) |

> **Portões obrigatórios antes de "concluído"**: Passo 2 (isolamento), Passo 3 (idempotência+assinatura
> de webhook) e a revisão de segurança multi-tenant (Princípios II/IV/V/VI).
