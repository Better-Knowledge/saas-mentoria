# Contract — Contas, Organização Ativa, Isolamento (RLS) e Gating de Plano

**Feature**: `002-saas-multitenant`

Define como uma requisição resolve **usuário + organização ativa**, como o isolamento é imposto (RLS) e
como os recursos do plano são liberados (gating). Aplica-se a UI, API REST e MCP.

## Contas e papéis

- **Signup** (`POST /api/auth/signup`): recebe `{ nome, email, senha, nome_org }`; cria `usuarios` +
  `organizations` + `memberships(papel='owner')`; inicia sessão (cookie httpOnly + CSRF) com
  `org_ativa = <nova org>`. E-mail único; senha forte (bcrypt). Sem assinatura ainda → estado "sem
  plano" (ver billing).
- **Login** (`POST /api/auth/login`): como hoje, mas a sessão passa a carregar `org_ativa` (a primeira
  membership, ou a última usada).
- **Papéis por org** (`memberships.papel`): `owner` (dono, billing), `admin`, `assistente`. Permissões
  finas por papel ficam simples na v1 (owner/admin gerenciam billing/chaves/WhatsApp; assistente opera o
  CRM).
- **Organização ativa**: `GET /api/orgs` lista as orgs do usuário; `POST /api/orgs/ativa` troca a org
  ativa da sessão. `GET /api/auth/me` retorna `{ usuario, org_ativa, papel, plano, entitlements, csrf }`.

## Resolução do principal (toda requisição autenticada)

| Credencial | Como resolve a org | `principal` |
|---|---|---|
| Sessão (pessoa) | `sessoes.org_ativa` | `{ tipo:'humano', usuario_id, org_id, papel, csrf }` |
| Bearer (chave/MCP) | `api_keys.org_id` da chave | `{ tipo:'ia', id, org_id, nome }` |
| Operador | — (cross-tenant explícito) | `{ tipo:'operador', usuario_id }` |

- Sem credencial válida → `401`. Sem org no contexto (ex.: usuário sem membership) → `403` "sem
  organização".

## Isolamento (RLS) — invariantes de contrato

- Toda operação que toca dados de tenant roda dentro de `withOrg(principal.org_id, …)`, que aplica
  `SET LOCAL app.current_org`. **Nenhuma** query de tenant roda fora desse contexto.
- A aplicação usa um papel de banco **sem `BYPASSRLS`**. Sem o setting, leitura é vazia e escrita falha.
- **Teste negativo obrigatório** (portão): autenticado na org A, qualquer tentativa de ler/editar/
  excluir um `id` da org B retorna **`404` "não encontrado"** (o RLS faz a linha "não existir"), nunca
  os dados. Vale para REST e MCP.
- Operador é a única exceção: consultas cross-tenant **explícitas**, num helper dedicado, restritas ao
  papel e **auditadas**.

## Gating de plano (entitlements)

`entitlements` derivam de `plans.features`/`limite_clientes` do plano da org **se** a assinatura estiver
em estado de acesso (`active`/`trialing` — o **trial de 14 dias** conta como acesso pleno do plano
escolhido —, ou `past_due` dentro da carência); senão → **suspenso** (somente leitura + tela de billing). Ver [billing-pagarme.md](billing-pagarme.md).

Middlewares (servidor, em todas as superfícies):

```js
requirePlan('whatsapp_ia')        // 403 + {erro, upgrade:true} se a feature não está no plano
requireWithinLimit('clientes')    // 403 se count(clientes da org) >= plano.limite_clientes
```

| Recurso | Regra |
|---|---|
| Criar cliente | `requireWithinLimit('clientes')` (UI, API, MCP, Gordon, ingestão de WhatsApp) |
| Relatórios avançados | `requirePlan('relatorios_avancados')` (Inter/VIP) |
| Automações de funil | `requirePlan('automacoes_funil')` (Inter/VIP) |
| Conectar WhatsApp / IA sobre conversas | `requirePlan('whatsapp_ia')` (VIP) |
| Gordon (chat) | disponível em todos (`gordon_chat`), respeitando os limites acima nas ações |

## Respostas de erro

| Situação | HTTP | Corpo |
|---|---|---|
| Não autenticado | `401` | `{ "erro": "Não autenticado" }` |
| Sem organização no contexto | `403` | `{ "erro": "Sem organização ativa" }` |
| Acesso a dado de outra org | `404` | `{ "erro": "Não encontrado" }` |
| Recurso fora do plano | `403` | `{ "erro": "Recurso indisponível no seu plano", "upgrade": true }` |
| Limite de clientes atingido | `403` | `{ "erro": "Limite de clientes do plano atingido", "upgrade": true }` |
| Assinatura suspensa (escrita) | `402` | `{ "erro": "Assinatura suspensa", "billing": true }` |

## Invariantes

- Nenhuma feature paga é liberada por sinal do front — só por `entitlements` do servidor.
- O `org_id` de toda escrita vem do principal, nunca do corpo.
- Trocar a org ativa não vaza cache de outra org (cada request resolve o contexto do zero).
