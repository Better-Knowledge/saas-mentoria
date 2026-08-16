# Servidor MCP — Acesso Remoto por Agentes de IA

> Escopo: `POST /mcp` · Transporte: **Streamable HTTP** (stateless) · Auth: **Bearer (chave de API)**
> Fonte: [`mcp/server.mjs`](../mcp/server.mjs), [`mcp/tools.mjs`](../mcp/tools.mjs), [`crm-service.js`](../crm-service.js)

O CRM expõe um servidor **MCP (Model Context Protocol)** para que agentes de IA leiam e escrevam
no CRM remotamente, sem usar a interface web. É o **plano de máquina** do produto: a interface é
para a pessoa; o MCP/REST é para a IA.

## Autenticação

| Item | Valor |
|---|---|
| Endpoint | `POST /mcp` |
| Base URL (produção) | `https://mentoria.crm.better-knowledge.com/mcp` |
| Autenticação | `Authorization: Bearer <CHAVE_DE_API>` — **obrigatória em toda requisição** |
| Content-Type | `application/json` |
| Accept | `application/json, text/event-stream` |

- A **chave de API** é a mesma credencial de máquina da API REST, emitida por um **admin** na tela
  **Integrações** (mostrada **uma única vez**) e **revogável** individualmente.
- Sem credencial válida → `401`. Não existe modo anônimo. Chave revogada → `401` na requisição seguinte.
- Toda escrita feita via MCP é auditada como **gerada por IA** (`created_by = "ia"` /
  `gerado_por_ia = 1`), derivado da credencial — **não** de qualquer campo enviado pelo agente.
- Em produção, o TLS é imposto na borda (Traefik HTTP→HTTPS + HSTS). Há rate limit em `/mcp`.

## Conceder e revogar acesso

1. Faça login como admin e abra **Integrações (API)** no menu do usuário.
2. Crie uma chave por integração (ex.: "Agente do WhatsApp") e **copie o segredo na hora**.
3. Para cortar o acesso de um agente, **revogue** a chave — as demais continuam valendo.

Equivalente por API (sessão admin): `POST /api/keys` e `DELETE /api/keys/:id`.

## Ferramentas (11) — paridade total com a API

| Ferramenta | O que faz | Escrita? |
|---|---|:--:|
| `listar_clientes` | Lista clientes/leads (com contagem de interações) | — |
| `obter_cliente` | Ficha completa + histórico | — |
| `acoes_hoje` | Follow-ups atrasados / hoje / futuros | — |
| `listar_interacoes` | Histórico de um cliente | — |
| `metricas` | Métricas do negócio (mesma fonte da tela Dashboard) | — |
| `criar_cliente` | Cria lead (só `nome` obrigatório) | ✍️ |
| `atualizar_cliente` | Edita dados do cliente | ✍️ |
| `mover_etapa` | Move no funil / define resultado | ✍️ |
| `registrar_interacao` | Adiciona anotação ao histórico | ✍️ |
| `exportar_cliente` | Exporta tudo do cliente (LGPD) | — |
| `excluir_cliente` | Exclui o cliente (LGPD) — **irreversível** | ✍️🗑️ |

Contrato detalhado (schemas de entrada, anotações) em
[`specs/001-mcp-server-auth/contracts/mcp-tools.md`](../specs/001-mcp-server-auth/contracts/mcp-tools.md)
— aquele documento descreve as 10 ferramentas originais; `metricas` foi acrescentada depois,
junto com a tela Dashboard, e sua fonte é [`mcp/tools.mjs`](../mcp/tools.mjs).
As operações destrutivas (`excluir_cliente`, `atualizar_cliente`, `mover_etapa`) trazem
`destructiveHint`, para o cliente de IA pedir confirmação quando apropriado.

### `metricas` — o que devolve

Sem parâmetros, somente leitura. Payload **idêntico** ao de `GET /api/dashboard` (verificado):
`kpis` (pipeline em aberto, pipeline ponderado, taxa de vitória, ticket médio, ciclo médio,
receita ganha), `serie` com 12 meses de ganhos/perdidos/novos, `funil` por etapa, `origens`
ordenadas por valor ganho, `tipos`, `autoria` (humano × IA) e `atencao` com as listas acionáveis.

Serve para o agente responder sobre desempenho, previsão de receita e o que precisa de follow-up
sem ter que listar todos os clientes e agregar por conta própria.

### Gestão de usuários **não** é exposta por MCP

É deliberado. As rotas `/api/usuarios` exigem **admin via sessão**; uma chave Bearer recebe `403`.
Máquinas operam o CRM, não administram contas humanas.

## Como conectar

### MCP Inspector (recomendado)

Aponte para `https://…/mcp` (ou `http://localhost:3000/mcp` em dev) com o header
`Authorization: Bearer <CHAVE>`. O Inspector mostra as 11 ferramentas e permite chamá-las.

### JSON-RPC direto (curl)

```bash
CHAVE=crm_xxxxxxxxxxxxxxxxxxxxxxxx
B=http://localhost:3000

# 1) descobrir ferramentas
curl -s -X POST $B/mcp -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 2) criar um lead (gravado como created_by="ia")
curl -s -X POST $B/mcp -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"criar_cliente","arguments":{"nome":"Maria Silva","origem":"WhatsApp"}}}'
```

## Erros

| Situação | Resultado |
|---|---|
| Sem Bearer / chave inválida ou revogada | HTTP `401` |
| Excesso de requisições | HTTP `429` |
| Entrada inválida (campo obrigatório, enum, tamanho) | erro de ferramenta (`isError`), sem gravação |
| Cliente inexistente | erro de ferramenta "Cliente nao encontrado" |

## Notas de arquitetura

- O servidor MCP roda **no mesmo processo** Express (sem porta/serviço extra), montado no bootstrap.
- As ferramentas chamam [`crm-service.js`](../crm-service.js) — a **mesma** camada usada pela API
  REST — garantindo comportamento e validação idênticos.
- Autenticação isolada atrás de `resolverPrincipal()` em [`auth.js`](../auth.js): hoje valida chaves
  Bearer; preparada para receber o fluxo OAuth do MCP no futuro sem quebrar as chaves existentes.
