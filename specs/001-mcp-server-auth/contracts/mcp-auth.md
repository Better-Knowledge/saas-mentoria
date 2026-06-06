# Contract — Autenticação do Endpoint MCP

**Feature**: `001-mcp-server-auth` · **Endpoint**: `POST /mcp` · **Transport**: Streamable HTTP

## Requisito

Toda requisição ao `/mcp` (incluindo o handshake `initialize` e `tools/list`) **exige** uma
credencial Bearer válida. Não existe acesso anônimo (FR-002).

## Cabeçalho

```http
POST /mcp HTTP/1.1
Host: mentoria.crm.better-knowledge.com
Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
Accept: application/json
```

- A credencial é uma **chave de API por integração** (tabela `api_keys`), emitida por um admin e
  mostrada uma única vez (`POST /api/keys`). É a **mesma** família de chave já usada na API REST.
- `Content-Type: application/json` e corpo JSON-RPC 2.0. `Accept: application/json` (modo
  `enableJsonResponse`).

## Fluxo de verificação (middleware `requireBearer`, antes do handler MCP)

1. Ler `Authorization`. Se não começar com `Bearer ` → `401` e **não** invocar o handler MCP.
2. `auth.verificarApiKey(chave)`:
   - chave inexistente **ou** `ativa = 0` (revogada) → retorna `null` → `401`.
   - válida → atualiza `ultimo_uso` e popula
     `req.principal = { tipo: 'ia', credencial: 'apikey', id, nome }`.
3. Rate limiting aplicado ao `/mcp` (proteção a força bruta de chave — FR-011).
4. Em produção, transporte criptografado (TLS via Traefik); requisição sem TLS é recusada (FR-010).

## Respostas de erro (antes do JSON-RPC)

| Situação | HTTP | Corpo |
|---|---|---|
| Sem header `Authorization: Bearer` | `401` | `{ "erro": "Não autenticado" }` |
| Chave inválida ou revogada | `401` | `{ "erro": "Chave de API inválida ou revogada" }` |
| Excesso de requisições | `429` | mensagem de rate limit |

> Erros de autenticação são resolvidos no nível HTTP, antes de entrar no protocolo MCP — um `401`
> faz o cliente MCP lançar `UnauthorizedError` imediatamente.

## Evolução planejada (híbrido — FR-014)

A verificação fica isolada atrás de uma função de **resolução de credencial**
(`resolverPrincipal(req) → principal | null`). No futuro, um validador de **tokens OAuth do MCP**
pode ser adicionado nessa função **sem quebrar** as chaves Bearer já emitidas: ambos os caminhos
produzem o mesmo `principal`. A v1 implementa apenas o caminho Bearer.

## Invariantes de contrato

- Nenhuma ferramenta MCP executa sem `req.principal` populado.
- `principal.tipo` é sempre `'ia'` no caminho MCP → toda escrita é auditada como `ia` (FR-008).
- Revogar a chave (`ativa=0`) bloqueia a próxima requisição em segundos (SC-003), sem afetar outras.
