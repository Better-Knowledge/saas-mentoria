# Research — Servidor MCP Autenticado

**Feature**: `001-mcp-server-auth` · **Date**: 2026-06-06

Todas as escolhas abaixo respeitam a constituição (Simplicidade, Segurança/LGPD, Interface Dupla,
Auditoria, Documentação). Não restam marcadores `NEEDS CLARIFICATION` — as duas decisões abertas do
spec (FR-013 paridade total; FR-014 auth híbrida) foram confirmadas pelo dono.

---

## D1 — Transporte MCP: Streamable HTTP (stateless, resposta JSON)

- **Decision**: Usar o transporte **Streamable HTTP** do SDK oficial em um único endpoint
  `POST /mcp`, em modo **stateless** (`sessionIdGenerator: undefined`) com `enableJsonResponse: true`
  (resposta JSON em vez de stream SSE), criando um transporte por requisição.
- **Rationale**: É o transporte padrão atual para servidores MCP **remotos**. Stateless casa com o
  uso request/response das ferramentas do CRM e com a Simplicidade (sem estado de sessão MCP a
  gerenciar). Resposta JSON simplifica o tráfego atrás do Traefik.
- **Alternatives considered**:
  - *stdio*: rejeitado — só funciona localmente (processo filho), não atende "acesso remoto".
  - *HTTP+SSE (transporte antigo, 2 endpoints)*: rejeitado — substituído pelo Streamable HTTP; manter
    SSE seria legado desnecessário.
  - *Streamable HTTP stateful (com `sessionId`)*: adiável — só agrega valor com streaming/notificações
    de longa duração, fora do escopo da v1.

## D2 — SDK: `@modelcontextprotocol/sdk` (oficial)

- **Decision**: Adicionar a dependência `@modelcontextprotocol/sdk` e usar `McpServer` +
  `registerTool` + o transporte Streamable HTTP do servidor.
- **Rationale**: SDK oficial, mantido, cobre o handshake, JSON-RPC, descoberta de ferramentas
  (`tools/list`) e validação de schema. Implementar o protocolo à mão violaria a Simplicidade e seria
  fonte de bugs de conformidade.
- **Alternatives considered**: implementação manual do protocolo (rejeitada — custo/erro altos);
  frameworks de terceiros (rejeitados — menos alinhados ao protocolo oficial).
- **Nota de versão**: fixar uma versão estável da linha 1.x no `package.json` e validar o caminho de
  import no ambiente de build (ver D5).

## D3 — Hospedagem: mesmo processo Express, endpoint `/mcp`

- **Decision**: Montar o handler MCP no **mesmo app Express** já existente, como `POST /mcp`,
  reutilizando `helmet`, o rate limiting e o deploy atual.
- **Rationale**: Simplicidade (um processo, um container, um deploy atrás do Traefik com TLS). Sem
  nova porta, sem novo serviço, sem nova entrada no Traefik.
- **Alternatives considered**: serviço/porta separada para o MCP (rejeitado — mais infra, mais deploy,
  sem benefício para um produto de dono único).

## D4 — Autenticação: Bearer reutilizando `api_keys`, com abstração para OAuth (híbrido)

- **Decision**: Um middleware `requireBearer` roda **antes** do handler `/mcp` e valida o header
  `Authorization: Bearer <chave>` com `auth.verificarApiKey()`. Sem chave válida → `401` e o handler
  MCP nem é invocado. A verificação fica isolada atrás de uma função de "resolução de credencial" para
  que, no futuro, um validador OAuth (tokens emitidos pelo fluxo MCP) possa ser plugado **sem quebrar**
  as chaves Bearer já emitidas.
- **Rationale**: Coerente com o Princípio III (plano de máquina = chaves por integração, revogáveis) e
  com o código atual (`requireAuth` já aceita Bearer). Entrega a v1 rápido; a abstração cumpre a
  decisão híbrida (FR-014) sem implementar o servidor de autorização OAuth agora.
- **Alternatives considered**:
  - *OAuth 2.1 do MCP já na v1*: rejeitado para v1 — exige servidor de autorização + fluxo de
    consentimento; complexidade desproporcional para o dono único. Fica como evolução planejada.
  - *Reutilizar a sessão de cookie/CSRF*: rejeitado — cookies/CSRF são o plano de **pessoas**;
    misturá-los com agentes violaria a separação de planos.
- **Segurança**: a chave já é guardada só como hash (`sha256`), revogável (`ativa=0`), e o middleware
  atualiza `ultimo_uso`. Rate limit no `/mcp` protege contra força bruta de chave.

## D5 — Interop ESM/CommonJS

- **Decision**: Manter o código MCP em arquivos **ESM** (`mcp/server.mjs`, `mcp/tools.mjs`) e
  carregá-los a partir do `server.js` (CommonJS) via `await import('./mcp/server.mjs')` dentro de um
  **bootstrap assíncrono**. O `server.js` passa a inicializar de forma async (montar `/mcp` e só então
  `app.listen`).
- **Rationale**: O SDK MCP é distribuído como ESM; `import()` dinâmico é a ponte suportada a partir de
  CommonJS sem migrar todo o projeto para ESM (Simplicidade — mudança localizada).
- **Alternatives considered**: migrar o projeto inteiro para ESM (rejeitado — mexe em tudo sem
  necessidade); usar um bundler/transpiler (rejeitado — adiciona etapa de build, contra a stack atual).

## D6 — Lógica compartilhada: `crm-service.js`

- **Decision**: Extrair a lógica de negócio hoje embutida nas rotas (montar/validar cliente, criar,
  atualizar, mover etapa, registrar interação, listar, ficha, hoje, exportar, excluir) para um módulo
  `crm-service.js` que recebe um **`autor`/`principal`** e devolve dados ou erros de domínio. As rotas
  REST e as ferramentas MCP passam a chamar esse módulo.
- **Rationale**: Garante que REST e MCP tenham **exatamente** o mesmo comportamento, validação e
  auditoria (Princípio V — contrato vivo e consistente). Evita duplicar regras (enums de etapa/
  resultado, whitelist `montaCliente`, limite de texto).
- **Alternatives considered**: ferramentas MCP acessando o `db` diretamente e reimplementando a
  validação (rejeitado — divergência inevitável entre os dois caminhos).
- **Nota**: a extração preserva o comportamento atual das rotas (refactor sem mudança funcional para o
  caminho REST).

## D7 — Auditoria derivada da credencial

- **Decision**: O `crm-service` recebe `autor = 'ia'` quando chamado pelas ferramentas MCP (principal
  do tipo API key) e grava `created_by='ia'` / `gerado_por_ia=1`. Nunca lê autoria de entrada do
  cliente.
- **Rationale**: Princípio IV e FR-008; idêntico ao `autorDe()` atual, agora também no caminho MCP.

## D8 — Validação, limites e erros

- **Decision**: Cada ferramenta declara um `inputSchema` (campos, tipos, enums) que o SDK valida antes
  de chamar o serviço; o serviço reaplica as regras de domínio (nome obrigatório, enums de etapa/
  resultado, texto ≤ 5000, payload ≤ 64 KB). Erros de domínio viram erros de ferramenta MCP claros,
  sem gravação parcial.
- **Rationale**: FR-009; consistência com a validação já existente na API.

## D9 — Catálogo de ferramentas (paridade total — FR-013)

Mapeamento 1:1 com os endpoints atuais (10 ferramentas):

| Ferramenta MCP | Operação CRM | Endpoint equivalente | Escrita? |
|---|---|---|:--:|
| `listar_clientes` | lista de clientes | `GET /api/clientes` | — |
| `obter_cliente` | ficha + interações | `GET /api/clientes/:id` | — |
| `acoes_hoje` | atrasados/hoje/futuros | `GET /api/hoje` | — |
| `listar_interacoes` | histórico do cliente | `GET /api/clientes/:id/interacoes` | — |
| `criar_cliente` | novo lead | `POST /api/clientes` | ✍️ |
| `atualizar_cliente` | editar cliente | `PUT /api/clientes/:id` | ✍️ |
| `mover_etapa` | mover funil/resultado | `PUT /api/clientes/:id/etapa` | ✍️ |
| `registrar_interacao` | nova anotação | `POST /api/clientes/:id/interacoes` | ✍️ |
| `exportar_cliente` | export LGPD | `GET /api/clientes/:id/export` | — |
| `excluir_cliente` | exclusão LGPD (irreversível) | `DELETE /api/clientes/:id` | ✍️🗑️ |

- **Rationale**: FR-013 — paridade total, incluindo exportar e excluir. As destrutivas são
  autenticadas, auditadas e limitadas por taxa; a contenção é a revogação da credencial (FR-004).
  As `annotations` do MCP marcam `excluir_cliente`/`atualizar_cliente`/`mover_etapa` como
  `destructiveHint`/não-idempotentes para que o cliente de IA peça confirmação quando apropriado.

## Resumo das decisões

Streamable HTTP stateless em `POST /mcp` no mesmo processo Express, SDK oficial carregado via ESM
dinâmico, Bearer reutilizando `api_keys` atrás de uma abstração pronta para OAuth, lógica única em
`crm-service.js`, auditoria derivada da credencial, validação por schema + regras de domínio, e
catálogo de 10 ferramentas com paridade total.
