---

description: "Task list for Servidor MCP Autenticado para Acesso de Agentes"
---

# Tasks: Servidor MCP Autenticado para Acesso de Agentes

**Input**: Design documents from `/specs/001-mcp-server-auth/`

**Prerequisites**: [plan.md](plan.md) (required), [spec.md](spec.md) (user stories), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: O spec **não** pediu testes automatizados; o projeto valida manualmente (constituição:
"verificação manual antes de concluir"). As tarefas de validação referenciam [quickstart.md](quickstart.md).

**Organization**: Tarefas agrupadas por user story para implementação e validação independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: a qual user story a tarefa pertence (US1, US2, US3)
- Caminhos de arquivo são relativos à raiz do repositório `crm-mentoria/`

## Path Conventions

- Projeto único, mesmo processo Express. Código novo do MCP em `mcp/*.mjs` (ESM); lógica
  compartilhada em `crm-service.js`; wiring em `server.js`/`auth.js` (CommonJS). Sem `src/`, sem build.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Trazer a dependência do MCP e o esqueleto de módulos.

- [X] T001 Adicionar a dependência `@modelcontextprotocol/sdk` em `package.json` e rodar `npm install`
- [X] T002 [P] Criar o diretório `mcp/` com os arquivos ESM vazios `mcp/server.mjs` e `mcp/tools.mjs`

**Checkpoint**: dependência instalada e estrutura de pastas pronta.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Camada compartilhada + autenticação Bearer + bootstrap async. **Bloqueia todas as user stories.**

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase terminar.

- [X] T003 Criar `crm-service.js` expondo as operações do CRM (`listarClientes`, `obterCliente`, `acoesHoje`, `listarInteracoes`, `criarCliente`, `atualizarCliente`, `moverEtapa`, `registrarInteracao`, `exportarCliente`, `excluirCliente`), cada escrita recebendo um `autor` (`humano`|`ia`); centralizar validação (enums `ETAPAS`/`RESULTADOS`, whitelist `montaCliente`, texto ≤ 5000, "não encontrado") e retornar resultado ou erro de domínio
- [X] T004 Refatorar as rotas em `server.js` para delegar ao `crm-service.js`, preservando o comportamento REST atual e derivando `autor` via `autorDe(req)` (depende de T003)
- [X] T005 [P] Adicionar em `auth.js` a abstração `resolverPrincipal(req)` e o middleware `requireBearer` (reusa `verificarApiKey`; `401` em ausência/inválida/revogada; define `req.principal = { tipo:'ia', credencial:'apikey', id, nome }`) e exportá-los
- [X] T006 Converter o startup de `server.js` em bootstrap **async** (para permitir `await import('./mcp/server.mjs')`) e adicionar um rate limiter dedicado para a rota `/mcp` (depende de T004)

**Checkpoint**: REST continua funcionando via `crm-service`; auth Bearer pronta; app sobe em bootstrap async. User stories podem começar.

---

## Phase 3: User Story 1 - Agente opera o CRM remotamente via MCP autenticado (Priority: P1) 🎯 MVP

**Goal**: Um agente autenticado conecta ao `/mcp`, descobre as ferramentas e lê/escreve no CRM (paridade total), com acesso anônimo barrado.

**Independent Test**: Conectar um cliente MCP com chave válida → `tools/list` traz 10 ferramentas; ler `acoes_hoje`/`listar_clientes`; criar lead; sem/!com chave inválida → `401`. (quickstart passos 2–7.)

### Implementation for User Story 1

- [X] T007 [US1] Definir as 10 ferramentas (name, description, `inputSchema`, `annotations`) em `mcp/tools.mjs` conforme [contracts/mcp-tools.md](contracts/mcp-tools.md) — sem campos `created_by`/`gerado_por_ia` na entrada
- [X] T008 [US1] Implementar `mcp/server.mjs`: criar `McpServer`, registrar as 10 ferramentas (cada uma chama `crm-service` passando `autor` derivado do principal da requisição) e exportar uma função que devolve um handler de transporte Streamable HTTP **stateless** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) (depende de T007, T003)
- [X] T009 [US1] Montar `POST /mcp` em `server.js`: aplicar `requireBearer` + o rate limiter de `/mcp`, depois `await import('./mcp/server.mjs')` e delegar ao handler, garantindo que `express.json({ limit })` cubra a rota (depende de T008, T005, T006)
- [X] T010 [US1] Encaminhar o `req.principal` (definido em `server.js`) até a execução de cada ferramenta em `mcp/server.mjs`, de forma que toda escrita chame `crm-service.js` com `autor` derivado da credencial (máquina → `'ia'`) (depende de T008, T009)
- [X] T011 [US1] Validação manual conforme [quickstart.md](quickstart.md) passos 2–7 (401 sem/!chave inválida; `initialize` + `tools/list` com 10 ferramentas; leitura; criação; erros de validação; exportar/excluir)

**Checkpoint**: US1 funcional e testável de forma independente — o MVP já entrega acesso remoto autenticado de agentes.

---

## Phase 4: User Story 2 - Dono concede e revoga o acesso de agentes (Priority: P2)

**Goal**: O dono emite uma credencial por integração e a revoga independentemente; a revogação corta o acesso ao MCP em segundos, sem afetar as demais.

**Independent Test**: Criar chave → agente usa com sucesso; revogar → próxima chamada `401`; outra chave segue válida. (quickstart passos 8–9.)

### Implementation for User Story 2

- [X] T012 [US2] Confirmar que as credenciais MCP são emitidas/revogadas pelo fluxo admin já existente (`POST /api/keys`, `DELETE /api/keys/:id`) e que a revogação (`ativa=0`) é honrada por `requireBearer`; ajustar se necessário em `auth.js`/`server.js`
- [X] T013 [US2] Atualizar a tela **Integrações** (`public/index.html`, `public/app.js`) para deixar claro que a chave de API é a credencial usada por agentes MCP remotos (mostrada uma vez, revogável)
- [X] T014 [US2] Validação manual conforme [quickstart.md](quickstart.md) passos 8–9 (chave revogada → `401` em segundos; outras chaves intactas; `ultimo_uso` atualiza)

**Checkpoint**: US1 + US2 funcionam de forma independente — o dono controla o acesso remoto dos agentes.

---

## Phase 5: User Story 3 - Auditoria confiável das ações dos agentes (Priority: P3)

**Goal**: Toda escrita via MCP é atribuída a `ia` derivado da credencial e não pode ser falsificada por entrada do cliente.

**Independent Test**: Criar lead via MCP enviando `created_by:"humano"` no corpo → registro fica `created_by:"ia"`; interação fica `gerado_por_ia:1`; ação pela UI permanece `humano`. (quickstart passo 5.)

### Implementation for User Story 3

- [X] T015 [US3] Garantir que os `inputSchema` em `mcp/tools.mjs` não aceitam `created_by`/`gerado_por_ia` e que `crm-service.js` força a autoria a partir do principal autenticado (nunca da entrada) (depende de T003, T007)
- [X] T016 [US3] Validação manual conforme [quickstart.md](quickstart.md) passo 5 (atribuição `ia` não falsificável; `gerado_por_ia:1`; ação de UI continua `humano`)

**Checkpoint**: as três user stories funcionam de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentação viva (Princípio V) e verificação de produção.

- [X] T017 [P] Documentar o servidor MCP em `README.md` (endpoint `/mcp`, autenticação Bearer, lista de ferramentas)
- [X] T018 [P] Criar `docs/MCP.md` descrevendo o acesso remoto por agentes, a emissão/revogação de credenciais e o catálogo de ferramentas (linkar [contracts/mcp-tools.md](contracts/mcp-tools.md))
- [X] T019 [P] Anotar em `README.md`/`openapi.yaml` que REST e MCP compartilham o comportamento via `crm-service.js`
- [X] T020 Verificar a postura de produção: `/mcp` atrás do Traefik com TLS, `helmet` + rate limit ativos, `NODE_ENV=production` (checklist de deploy; sem mudança em `Dockerfile`/`docker-compose.yml`)
- [X] T021 Revisão de segurança (Princípios II e IV) **antes de produção / dados reais**: confirmar que 100% do `/mcp` exige Bearer (sem caminho anônimo), que a auditoria `created_by='ia'`/`gerado_por_ia` é derivada da credencial e **não-falsificável**, e que `excluir_cliente`/`exportar_cliente` ficam autenticadas, auditadas e sob rate limit; registrar achados em nova seção "Acesso MCP" de `docs/SEGURANCA.md` (pode usar `/security-review` sobre o diff da branch)
- [X] T022 Rodar [quickstart.md](quickstart.md) de ponta a ponta como passe final de aceite

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — começa imediatamente.
- **Foundational (Phase 2)**: depende do Setup — **BLOQUEIA** todas as user stories.
- **User Stories (Phase 3+)**: todas dependem da Foundational. US2 e US3 exercitam o caminho `/mcp`
  entregue por US1, então rodam após US1 (ou em paralelo por outra pessoa, mas validadas após US1).
- **Polish (Phase 6)**: depois das user stories desejadas.

### User Story Dependencies

- **US1 (P1)**: começa após a Foundational. Entrega o MVP (acesso remoto autenticado + paridade total).
- **US2 (P2)**: reusa o fluxo de chaves existente; valida revogação contra o `/mcp` de US1.
- **US3 (P3)**: a mecânica de auditoria vive na Foundational + US1; US3 garante e valida a não-falsificação.

### Within Phases

- T003 → T004 (mesmo destino lógico) → T006 (mesmo arquivo `server.js`).
- T007 → T008 → T009 → T010 → T011 (validação por último).
- T005 (auth.js) é [P] em relação a T003 (crm-service.js).

### Parallel Opportunities

- **Setup**: T002 [P] em paralelo a T001 (arquivos diferentes).
- **Foundational**: T005 [P] (auth.js) em paralelo a T003 (crm-service.js).
- **Polish**: T017, T018, T019 [P] (arquivos de documentação diferentes).

---

## Parallel Example: Foundational

```bash
# Após o Setup, rodar em paralelo (arquivos diferentes):
Task: "T003 Criar crm-service.js com as operações do CRM e validação centralizada"
Task: "T005 [P] Adicionar requireBearer + resolverPrincipal em auth.js"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T006) — **crítico, bloqueia tudo**
3. Phase 3: US1 (T007–T011)
4. **PARAR e VALIDAR**: rodar quickstart passos 2–7 → acesso remoto autenticado funcionando.
5. Deploy/demo se pronto.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. + US1 → validar → deploy/demo (MVP: agente lê/escreve via MCP autenticado).
3. + US2 → validar revogação → deploy/demo (dono controla acesso).
4. + US3 → validar auditoria não-falsificável → deploy/demo.
5. Polish (docs + checklist de produção).

---

## Notes

- [P] = arquivos diferentes, sem dependência pendente.
- Sem testes automatizados (não solicitados); validação manual via [quickstart.md](quickstart.md).
- `crm-service.js` é o ponto único que mantém REST e MCP em paridade (Princípio V) e a auditoria
  derivada da credencial (Princípio IV).
- Sem mudança de schema; credenciais reaproveitam `api_keys` (Princípio I/III).
- Commit após cada tarefa ou grupo lógico; parar em qualquer checkpoint para validar a story.
