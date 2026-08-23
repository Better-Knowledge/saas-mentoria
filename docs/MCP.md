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

---

## Resumo de reunião (feature 002)

Cinco ferramentas espelham as rotas REST de resumo. Paridade verificada por
`tests/parity.test.js` — não há dispensa.

| Ferramenta | O que faz | Anotações |
|---|---|---|
| `extrair_resumo_reuniao` | Transcrição → rascunho para revisão. **Não grava nada.** | `openWorldHint: true` — única que alcança serviço externo, e cada chamada tem custo |
| `obter_rascunho_resumo` | Lê o rascunho. Só o dono enxerga | `readOnlyHint: true` |
| `confirmar_resumo_reuniao` | Grava o revisado no histórico | grava `revisao: sem_revisao` quando vem de chave de API |
| `descartar_resumo_reuniao` | Descarta o rascunho | `destructiveHint: true` — irreversível |
| `obter_transcricao` | Lê a fonte, enquanto ela existir (90 dias) | `readOnlyHint: true` |

### Duas fronteiras deliberadas

1. **Nenhum `inputSchema` aceita campo de autoria ou de revisão.** O agente não pode se
   declarar humano nem marcar o próprio registro como revisado — isso vem da credencial.
2. **`confirmar_resumo_reuniao` não aceita `promover_proxima_acao`.** Um agente que queira
   mudar a próxima ação usa `atualizar_cliente`, numa chamada separada e explícita. Isso
   mantém a regra "extração nunca escreve em campo de negócio" idêntica nos dois planos, e
   deixa a alteração de campo auditável por si.

### Registro confirmado por máquina aparece diferente na ficha

Uma chave de API pode criar **e** confirmar o próprio rascunho — decisão registrada na spec
desta feature. O registro entra marcado como **não revisado por humano**, com chip de atenção
na ficha e na trilha de auditoria. Quem lê o histórico meses depois consegue distinguir o que
uma pessoa conferiu do que nenhuma pessoa viu.

### Exemplo por curl

```bash
CHAVE=crm_sua_chave_aqui

# 1) descobrir as ferramentas
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $CHAVE" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 2) extrair (não grava nada)
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $CHAVE" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"extrair_resumo_reuniao",
        "arguments":{"id":29,"transcricao":"Maria: o orcamento foi aprovado..."}}}'

# 3) confirmar o rascunho devolvido acima
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $CHAVE" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
        "name":"confirmar_resumo_reuniao",
        "arguments":{"id":3,"resumo":"Orcamento aprovado.",
                     "decisoes":[{"texto":"Seguir com o diagnostico"}]}}}'
```

Sem o header `Authorization`, qualquer uma delas responde `401`. Um cookie de sessão **não**
substitui a chave: os dois planos de credencial não são intercambiáveis, e
`tests/resumo-api.test.js` fixa essa fronteira.
