# Quickstart — Validar o Servidor MCP Autenticado

**Feature**: `001-mcp-server-auth` · **Date**: 2026-06-06

Guia de validação manual de ponta a ponta. Prova que o MCP funciona, está autenticado, audita
corretamente e respeita a revogação. (O projeto não usa framework de testes — a constituição pede
verificação manual antes de concluir.)

## Pré-requisitos

- Node.js 20 LTS (mínimo 18).
- Dependências instaladas, incluindo a nova: `npm install` (com `@modelcontextprotocol/sdk` no
  `package.json`).
- `.env` com `ADMIN_EMAIL` e `ADMIN_SENHA` definidos (o primeiro start cria o admin).
- Servidor no ar: `npm start` → `http://localhost:3000`.

## Passo 1 — Emitir uma credencial de agente (plano de máquina)

1. Faça login na UI (`/`) com o admin e abra **Integrações** (menu do usuário).
2. Crie uma chave (ex.: "Agente de Teste"). **Copie o segredo agora** — ele aparece uma única vez.
   - Equivalente por API (sessão admin): `POST /api/keys` com `{ "nome": "Agente de Teste" }`.
3. Guarde como `CHAVE=crm_...` para os passos seguintes.

## Passo 2 — Sem credencial = barrado (FR-002 / SC-002)

Chamar o `/mcp` sem Bearer deve retornar `401` e **não** expor nada:

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Esperado**: `HTTP/1.1 401` com `{ "erro": "Não autenticado" }`. Repita com um Bearer inválido →
`401` `{ "erro": "Chave de API inválida ou revogada" }`.

## Passo 3 — Handshake + descoberta de ferramentas (FR-001 / FR-005)

Use o **MCP Inspector** (recomendado) apontando para `http://localhost:3000/mcp` com header
`Authorization: Bearer <CHAVE>`, ou JSON-RPC via `curl`:

```bash
# initialize
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# tools/list
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

**Esperado**: `tools/list` retorna as **10 ferramentas** de [contracts/mcp-tools.md](contracts/mcp-tools.md)
(`listar_clientes`, `obter_cliente`, `acoes_hoje`, `listar_interacoes`, `criar_cliente`,
`atualizar_cliente`, `mover_etapa`, `registrar_interacao`, `exportar_cliente`, `excluir_cliente`),
cada uma com `inputSchema`.

## Passo 4 — Leitura (FR-006)

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"acoes_hoje","arguments":{}}}'
```

**Esperado**: objeto `{ atrasados, hoje, futuros }`. Teste também `listar_clientes`.

## Passo 5 — Criar lead e checar auditoria (FR-007 / FR-008 / SC-004)

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"criar_cliente","arguments":{"nome":"Lead via MCP","origem":"Teste","created_by":"humano"}}}'
```

**Esperado**: cliente criado com **`created_by: "ia"`** — mesmo tendo enviado `"humano"` no corpo
(atribuição não falsificável). Adicione uma interação com `registrar_interacao` e confirme
`gerado_por_ia: 1`. Uma criação feita pela UI permanece `created_by: "humano"`.

## Passo 6 — Validação rejeita entrada inválida (FR-009 / SC-007)

- `criar_cliente` com `nome` vazio → erro "O campo nome é obrigatório", sem criar registro.
- `mover_etapa` com `etapa` fora do enum → erro, registro inalterado.
- `registrar_interacao` com texto > 5000 → erro.

## Passo 7 — Paridade LGPD: exportar e excluir (FR-013)

```bash
# exportar (id do lead criado no passo 5)
curl -s -X POST http://localhost:3000/mcp -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"exportar_cliente","arguments":{"id":<ID>}}}'

# excluir (irreversível)
curl -s -X POST http://localhost:3000/mcp -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"excluir_cliente","arguments":{"id":<ID>}}}'
```

**Esperado**: export retorna ficha + interações; exclusão retorna `{ ok:true, removido:<ID> }` e o
cliente some das leituras seguintes.

## Passo 8 — Revogação corta o acesso (FR-004 / SC-003)

1. Na tela **Integrações**, revogue a chave (ou `DELETE /api/keys/:id`).
2. Repita qualquer chamada do Passo 4 com a **mesma** `$CHAVE`.

**Esperado**: `401` em segundos. Uma **outra** chave ativa continua funcionando (revogação isolada).

## Passo 9 — Monitoramento (FR-012 / SC-006)

Na tela **Integrações**, confirme que o **último uso** da chave foi atualizado após as chamadas.

## Critérios de aceite cobertos

| Passo | Cobre |
|---|---|
| 2 | FR-002, SC-002 |
| 3 | FR-001, FR-005 |
| 4 | FR-006 |
| 5 | FR-007, FR-008, SC-004 |
| 6 | FR-009, SC-007 |
| 7 | FR-013 (exportar/excluir) |
| 8 | FR-004, SC-003 |
| 9 | FR-012, SC-006 |
| produção | FR-010 (TLS via Traefik), FR-011 (rate limit) |

> SC-001 (onboarding < 10 min) é validado executando os Passos 1→4 com cronômetro: emitir a chave e
> obter a primeira leitura autenticada.
