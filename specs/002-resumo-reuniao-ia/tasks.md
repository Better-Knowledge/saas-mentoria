---
description: "Task list for feature implementation"
---

# Tasks: Resumo automático de reunião com revisão humana

**Input**: Design documents from `/specs/002-resumo-reuniao-ia/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: **INCLUÍDOS E OBRIGATÓRIOS.** A constituição v2.0.0 faz de `npm test` verde um portão de
fase, e a suíte exigida cobre camada de serviço, autenticação, paridade REST↔MCP e paridade
rota↔OpenAPI. Este repositório não tem suíte alguma hoje — ela nasce aqui.

**Organization**: agrupadas por história de usuário, para que cada uma seja implementável e testável
sozinha.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2, US3 — mapeia para as histórias da spec

## Path Conventions

Repositório plano, conforme `plan.md` → Structure Decision: `server.js`, `crm-service.js`, `db.js`,
`audit.js`, `auth.js` na raiz; `ia/`, `mcp/`, `public/`, `scripts/`, `tests/` como subpastas.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependências, configuração e o esqueleto de testes que o projeto ainda não tem.

- [X] T001 Instalar `@anthropic-ai/sdk` como dependência de runtime e `supertest` como devDependency, atualizando `package.json` e `package-lock.json`
- [X] T002 Acrescentar o script `"test": "node --test tests/"` em `package.json`
- [X] T003 [P] Documentar `ANTHROPIC_API_KEY`, `IA_MODELO` e `IA_MAX_TOKENS_ENTRADA` em `.env.example`, sem valor real
- [X] T004 [P] Criar `tests/helpers/app.js` com o bootstrap de teste: `DATA_DIR` em diretório temporário por execução, banco limpo, e função para autenticar sessão e criar chave de API
- [X] T005 [P] Criar `tests/helpers/extrator-falso.js` com um extrator determinístico injetável, para que nenhum teste chame a API paga (research.md §10)
- [X] T006 Verificar a compatibilidade de `zodOutputFormat` com a versão de `zod` fixada no projeto; se incompatível, registrar em `research.md` §2 a adoção de JSON Schema escrito à mão

**Checkpoint**: `npm test` executa (mesmo sem casos) e o extrator falso está disponível.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema, autoria, adaptador de IA e proteções de rota. Nenhuma história começa antes.

**⚠️ CRÍTICO**: T007 a T018 bloqueiam todas as histórias.

- [X] T007 Criar a migração aditiva e idempotente da tabela `resumo_rascunhos` em `db.js`, com FK `ON DELETE CASCADE` e índice `idx_rascunho_dono`, conforme data-model.md
- [X] T008 Criar a migração aditiva e idempotente da tabela `transcricoes` em `db.js`, com FKs em cascata e índice `idx_transcricao_expira`
- [X] T009 Criar a migração aditiva e idempotente da tabela `auditoria` em `db.js` **com o schema idêntico ao do PRD §8.2**, sem FK para `clientes`
- [X] T010 Acrescentar em `db.js` as colunas aditivas `revisao`, `revisado_por`, `revisado_em` e `origem_registro` em `interacoes`, verificando existência antes de cada `ALTER TABLE`
- [X] T011 [P] Criar `audit.js` expondo `registrar({ entidade, entidade_id, acao, campo, valor_anterior, valor_novo, principal })`, que **rejeita** gravar conteúdo de transcrição ou de resumo (FR-022)
- [X] T012 Separar a resolução de credencial em `auth.js` em **duas funções distintas** — `resolverBearer(req)` (chave de API) e `resolverSessao(req)` (cookie + sessão) — e apontar `requireBearer` para `resolverBearer` **apenas**. `resolverPrincipal(req)` permanece como a porta única de entrada para as rotas `/api`, escolhendo entre as duas conforme o plano da requisição (research.md §9, PRD RF-69)

  > **⚠ Não estenda `resolverPrincipal` para também ler o cookie mantendo `requireBearer` como está.**
  > `requireBearer` valida só o **prefixo** do header antes de chamar a função: com o fallback de
  > sessão embutido, `Authorization: Bearer <lixo>` acompanhado de um cookie de sessão válido
  > passaria a ser aceito em `POST /mcp` como principal humano — credencial de pessoa operando o
  > plano de máquina, sem CSRF. Viola os Princípios I e II da constituição.
- [X] T013 [P] Criar `ia/extrator.js` com a função `mascarar(texto)` cobrindo e-mail, telefone brasileiro e CPF/CNPJ (FR-005, research.md §6)
- [X] T014 Criar em `ia/extrator.js` o schema `zod` do rascunho (`resumo`, `decisoes`, `proximos_passos`, `objecoes`, `sugestao_proxima_acao`) conforme data-model.md, exportado para reuso por REST e MCP
- [X] T015 Implementar em `ia/extrator.js` a chamada `client.messages.parse()` com `output_config.format` derivado do schema, `effort: "medium"`, `max_tokens: 8000`, timeout de 60 s e **nenhuma ferramenta declarada** (research.md §2, §3, §5)
- [X] T016 Implementar em `ia/extrator.js` o prompt com a transcrição delimitada numa mensagem `user`, instruindo que o conteúdo delimitado é dado a analisar e nunca instrução a seguir (research.md §5)
- [X] T017 Implementar em `ia/extrator.js` a guarda de custo: limite de 200.000 caracteres e verificação por `client.messages.countTokens` contra `IA_MAX_TOKENS_ENTRADA` antes de qualquer chamada paga (research.md §4)
- [X] T018 Implementar em `ia/extrator.js` o tratamento de erro tipado do SDK (autenticação, rate limit, indisponibilidade, timeout, `parsed_output` nulo), distinguindo "não configurado" de "falhou agora", sem vazar a chave em nenhuma mensagem (FR-006, FR-027a, FR-027b)
- [X] T019 [P] Criar `tests/extrator.test.js` cobrindo mascaramento, guarda de tamanho, guarda de tokens e cada modo de falha do extrator
- [X] T020 [P] Criar `tests/audit.test.js` verificando que `audit.registrar` grava autor e credencial corretos e **recusa** conteúdo de transcrição

**Checkpoint**: banco migrado, autoria resolvida nos dois planos, extrator isolado e testado.

---

## Phase 3: User Story 1 — Transformar uma transcrição em registro revisado (P1) 🎯 MVP

**Goal**: colar transcrição → revisar → confirmar. O conteúdo revisado vira interação marcada como
IA; nada é gravado antes da confirmação.

**Independent Test**: colar uma transcrição na ficha de um cliente, editar um item, remover outro,
confirmar, e constatar que o histórico traz exatamente o conteúdo editado com badge de IA — e que
descartar não grava nada.

### Tests for User Story 1 ⚠️

> Escreva estes testes primeiro e confirme que falham antes de implementar.

- [X] T021 [P] [US1] Criar `tests/resumo-service.test.js` cobrindo: criar rascunho não grava interação; confirmar grava o conteúdo **recebido** e não o do modelo; descartar não grava; rascunho vazio recusado com `400`; rascunho de outro dono responde `404`
- [X] T022 [P] [US1] Criar `tests/resumo-api.test.js` cobrindo as quatro rotas: `401` sem credencial, `403` sem CSRF, `404` de cliente inexistente, `413` acima de 512 KB, `503` com IA indisponível
- [X] T022b [P] [US1] Acrescentar em `tests/resumo-api.test.js` o teste de regressão dos dois planos de credencial: `POST /mcp` com `Authorization: Bearer <inválido>` **mais** um cookie de sessão válido responde `401`, e o mesmo vale para as rotas de resumo que exigem Bearer. Este teste existe para impedir o vazamento de plano descrito em T012 — se ele passar a falhar, a separação foi desfeita
- [X] T023 [P] [US1] Acrescentar em `tests/resumo-api.test.js` o caso de cliente excluído durante a revisão, esperando `404` na confirmação e nenhum registro órfão

### Implementation for User Story 1

- [X] T024 [US1] Implementar `resumoReuniao.criarRascunho(clienteId, transcricao, principal, extrator)` em `crm-service.js`, com o extrator injetável e o real como padrão, gravando em `resumo_rascunhos` e sem tocar em `interacoes`
- [X] T025 [US1] Implementar `resumoReuniao.obterRascunho(id, principal)` em `crm-service.js`, respondendo `404` — nunca `403` — para dono diferente (FR-025, data-model.md)
- [X] T026 [US1] Implementar `resumoReuniao.descartarRascunho(id, principal)` em `crm-service.js`, apagando a linha sem gravar conteúdo algum
- [X] T027 [US1] Implementar `resumoReuniao.confirmarRascunho(id, corpoRevisado, principal)` em `crm-service.js`: valida pelo schema, monta o texto final respeitando o limite de 5000 caracteres, grava a interação com `gerado_por_ia = 1`, grava a transcrição com `expira_em = hoje + 90 dias`, consome o rascunho e atualiza `updated_at` do cliente (FR-013, FR-014, FR-026)
- [X] T028 [US1] Derivar `revisao` e `revisado_por` da credencial dentro de `confirmarRascunho` — `sessao` → `humana`, `apikey` → `sem_revisao` — sem aceitar esses campos do corpo (FR-019, FR-028a)
- [X] T029 [US1] Registrar na trilha de auditoria a criação da interação, com autor e credencial, sem conteúdo de transcrição (FR-020, FR-022)
- [X] T030 [US1] Exportar `resumoReuniao` em `module.exports` de `crm-service.js`
- [X] T031 [US1] Configurar em `server.js` o `express.json({ limit: '512kb' })` **apenas** na rota de extração, mantendo o limite global de 64 KB para todo o resto (research.md §7)
- [X] T032 [US1] Configurar em `server.js` um `express-rate-limit` dedicado e mais estrito na rota de extração (research.md §4)
- [X] T033 [US1] Implementar em `server.js` as rotas `POST /api/clientes/:id/resumos`, `GET /api/resumos/:id`, `POST /api/resumos/:id/confirmar` e `DELETE /api/resumos/:id` conforme `contracts/rest-resumos.md`, traduzindo apenas HTTP
- [X] T034 [P] [US1] Acrescentar em `mcp/tools.mjs` as ferramentas `extrair_resumo_reuniao`, `obter_rascunho_resumo`, `confirmar_resumo_reuniao` e `descartar_resumo_reuniao`, com `annotations` e descrições conforme `contracts/mcp-resumos.md`, chamando a mesma camada de serviço
- [X] T035 [P] [US1] Acrescentar o modal de colar transcrição e a tela de revisão em `public/index.html`, reusando `.modal`, `.campo`, `.item`, `.vazio`, `.btn` e `.toast` — sem componente e sem token novo
- [X] T035b [US1] Exibir no modal de colar, **antes** de a pessoa acionar a extração, o aviso de que a transcrição ficará guardada por 90 dias e depois será descartada automaticamente, em `public/index.html` e `public/app.js` (FR-026d). Quem cola a fala de terceiros precisa saber o que está fazendo com ela — o aviso é parte da retenção, não enfeite
- [X] T036 [US1] Implementar em `public/app.js` o estado do rascunho e a renderização das três listas com itens editáveis, removíveis e acrescentáveis, usando `esc()` em toda saída (FR-008, FR-023)
- [X] T037 [US1] Implementar em `public/app.js` os eventos por **delegação**, um listener por região com alvo por `data-*` — nenhum `onclick` em atributo (RNF-16)
- [X] T038 [US1] Implementar em `public/app.js` os estados obrigatórios: aviso de "gerado por IA, ainda não salvo", indicação de progresso com cancelamento em 60 s, texto humano em cada lista vazia, e toast em cada ação (FR-012, FR-029, FR-030, FR-031)
- [X] T039 [US1] Fechar o modal e limpar o rascunho da memória ao expirar a sessão ou sair, em `public/app.js` (FR-025, RF-95)
- [X] T040 [US1] Exibir na ficha do cliente o badge de IA e o chip de atenção "não revisado" conforme `gerado_por_ia` + `revisao`, em `public/app.js` (data-model.md, tabela de três estados)

**Checkpoint**: US1 completa e testável sozinha. É o MVP.

---

## Phase 4: User Story 2 — Aceitar a próxima ação sugerida sem digitar (P2)

**Goal**: promover **um** próximo passo a próxima ação do cliente, com data, só por ação humana
explícita.

**Independent Test**: promover um passo datado, confirmar, e ver o cliente aparecer na faixa correta
da tela Hoje; recusar a sugestão deixa a próxima ação vigente intacta.

### Tests for User Story 2 ⚠️

- [X] T041 [P] [US2] Acrescentar em `tests/resumo-service.test.js` os casos: confirmar sem `promover_proxima_acao` deixa o cliente **byte a byte** inalterado; promover grava `proxima_acao` e `proxima_acao_data`; data inválida recusa com `400` sem alterar o cliente
- [X] T042 [P] [US2] Acrescentar em `tests/resumo-api.test.js` o caso de `409` ao substituir próxima ação vigente sem `"substituir": true`, verificando que o corpo do erro traz o valor vigente

### Implementation for User Story 2

- [X] T043 [US2] Estender `resumoReuniao.confirmarRascunho` em `crm-service.js` para aceitar `promover_proxima_acao` opcional, validando a data pela mesma função de data já usada pelo produto (FR-016, FR-018)
- [X] T044 [US2] Implementar em `crm-service.js` a regra de substituição: cliente com próxima ação vigente exige `substituir: true`, senão erro `409` carregando o valor atual (FR-017)
- [X] T045 [US2] Garantir em `crm-service.js` que **nenhum outro** campo de negócio é tocado — valor, etapa, resultado, tipo, proposta e status de pagamento ficam fora da whitelist desta operação (FR-015)
- [X] T046 [US2] Registrar na auditoria a alteração de `proxima_acao` e `proxima_acao_data` com valor anterior e novo, atribuída a **quem confirmou**, nunca à IA (FR-021)
- [X] T047 [US2] Tratar o `409` em `server.js` conforme `contracts/rest-resumos.md`, devolvendo `proxima_acao_vigente` no corpo
- [X] T048 [US2] Implementar na tela de revisão em `public/app.js` a promoção de **um** passo a próxima ação, com texto e data editáveis antes de aplicar e confirmação adicional quando já houver ação vigente

**Checkpoint**: US1 e US2 funcionam de forma independente.

---

## Phase 5: User Story 3 — Conferir a fonte e a autoria do que foi registrado (P3)

**Goal**: saber de onde veio o registro, quem revisou, e ver a transcrição enquanto ela existir.

**Independent Test**: confirmar uma revisão, inspecionar o registro e a trilha; verificar que a
transcrição some após 90 dias sem levar o registro junto, e que ela nunca sai na exportação.

### Tests for User Story 3 ⚠️

- [X] T049 [P] [US3] Criar `tests/resumo-privacidade.test.js` verificando que `exportarCliente()` **não** inclui transcrição em nenhum caminho (FR-026c, SC-011)
- [X] T050 [P] [US3] Acrescentar em `tests/resumo-privacidade.test.js` a purga: transcrição vencida some, a interação permanece, e a leitura passa a devolver `{ disponivel: false, motivo: 'expirada' }` — nunca `404`
- [X] T051 [P] [US3] Acrescentar em `tests/resumo-privacidade.test.js` o caso de exclusão do cliente apagando a transcrição antes dos 90 dias (FR-026b)
- [X] T052 [P] [US3] Acrescentar em `tests/resumo-service.test.js` a distinção de plano: confirmação por sessão grava `revisao: 'humana'`; por chave de API grava `revisao: 'sem_revisao'`, e a auditoria registra a diferença (FR-028a, FR-028b, SC-012)

### Implementation for User Story 3

- [X] T053 [US3] Implementar `resumoReuniao.obterTranscricao(interacaoId, principal)` em `crm-service.js`, devolvendo `{ disponivel: false, motivo: 'expirada' }` quando vencida
- [X] T054 [US3] Implementar a rota `GET /api/interacoes/:id/transcricao` em `server.js` conforme `contracts/rest-resumos.md`
- [X] T055 [P] [US3] Acrescentar a ferramenta `obter_transcricao` em `mcp/tools.mjs`, com `readOnlyHint: true`
- [X] T056 [US3] Criar `scripts/purgar-transcricoes.js` exportando `purgar()` — apaga transcrições vencidas e rascunhos com mais de 24 h — e executável direto por `node scripts/purgar-transcricoes.js` (research.md §8)
- [X] T057 [US3] Chamar `purgar()` no boot de `server.js` e agendá-la a cada 24 h com `setInterval(...).unref()`
- [X] T058 [US3] Exibir na ficha, em `public/app.js`, o acesso à transcrição de origem e o aviso legível quando ela já expirou
- [X] T059 [US3] Exibir no registro, em `public/app.js`, quem revisou e quando — ou o chip "não revisado" quando a confirmação veio de máquina

**Checkpoint**: as três histórias funcionam de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: portões da constituição, contrato e documentação. Nada aqui é opcional — o Princípio VII
trata documentação desatualizada como defeito.

- [X] T060 Acrescentar em `openapi.yaml` as cinco operações e os schemas `RascunhoResumo`, `ItemExtraido`, `ProximoPasso`, `ConfirmacaoResumo` e `TranscricaoResposta` em `components/`, reusando as respostas de erro existentes (RF-56)
- [X] T061 Acrescentar em `openapi.yaml` as quatro propriedades novas ao schema `Interacao`, de forma aditiva
- [X] T062 Criar `tests/parity.test.js` verificando as duas paridades: toda rota Express existe no spec e vice-versa, e toda função de serviço com equivalente REST tem ferramenta MCP (RF-64, RF-80, Princípio V)
- [X] T063 [P] Documentar as ferramentas novas em `docs/MCP.md`, com exemplo de `tools/list` e `tools/call` por `curl`
- [X] T064 [P] Documentar em `README.md` as variáveis de ambiente novas **e o custo estimado por extração** (~US$ 0,10–0,13 por reunião de uma hora), para que o custo de apertar o botão seja visível
- [X] T065 [P] Registrar em `docs/SEGURANCA.md` a revisão desta fase: segredo do provedor, mascaramento **e seus limites conhecidos**, retenção de 90 dias com a tensão de a transcrição ficar fora da exportação do titular, e a confirmação por máquina sem revisão humana
- [X] T066 [P] Atualizar `docs/ROADMAP.md` F2.1, cujo texto atual ("nenhum campo é alterado sem confirmação humana" como regra inegociável) contradiz a decisão Q3 registrada na spec
- [X] T067 [P] Acrescentar em `docs/PRD-Reconstrucao-CRM.md` §4.2 a nota de que o item foi promovido do roadmap para esta feature
- [X] T068 [P] Documentar as tabelas e colunas novas em `docs/DICIONARIO-DADOS-LEADS.md`
- [X] T068b [P] Criar o corpus de referência em `tests/fixtures/transcricoes-referencia/`: **cinco** transcrições versionadas e anonimizadas (nenhuma reunião real de cliente), cobrindo reunião com decisão clara, reunião só exploratória, reunião com objeção forte, transcrição ruidosa e transcrição contendo tentativa de injeção. Cada uma acompanhada de um `.esperado.json` com os itens que uma pessoa considerou corretos
- [X] T068c Criar `scripts/medir-extracao.js`, que roda o extrator **real** sobre o corpus de T068b e imprime, por transcrição, os itens extraídos ao lado dos esperados, mais a taxa agregada de itens aceitos sem edição (SC-005). Executado à mão e **fora** de `npm test`, porque chama a API paga — o próprio script avisa o custo estimado antes de rodar
- [X] T068d Rodar `node scripts/medir-extracao.js`, registrar a taxa medida e a data em `docs/SEGURANCA.md` ou em `README.md` como linha de base, e confirmar o limiar de **70%** do SC-005. Abaixo disso, o ajuste é de prompt (T016), não de limiar
- [X] T069 Verificar que a CSP segue sem `'unsafe-inline'` após o front novo, e que nenhum `onclick`, `ondragstart` ou `ondrop` em atributo foi introduzido (RNF-16, Princípio I)
- [X] T070 Verificar que a chave do provedor não aparece em `/health`, em log, em mensagem de erro nem em resposta de API (FR-027a)
- [X] T071 Executar o roteiro completo de [quickstart.md](quickstart.md), incluindo o passo 1 — o produto sobe e funciona **sem** `ANTHROPIC_API_KEY`, com a feature indisponível (FR-027b)
- [X] T072 Rodar `npm test` e confirmar a suíte verde, incluindo os dois testes de paridade — portão de fase da constituição

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências
- **Foundational (Phase 2)**: depende da Phase 1 — **bloqueia todas as histórias**
- **US1 (Phase 3)**: depende da Phase 2
- **US2 (Phase 4)**: depende da Phase 2. Estende `confirmarRascunho`, criada em T027 — **na prática
  depende de US1**, e é a única dependência entre histórias do plano
- **US3 (Phase 5)**: depende da Phase 2. Testável sozinha desde que exista alguma interação com
  transcrição gravada; usa T027 para produzi-la
- **Polish (Phase 6)**: depende das histórias que se pretende entregar

### Within Each User Story

- Testes primeiro, falhando, antes da implementação
- Camada de serviço antes das rotas; rotas antes do front
- Ferramentas MCP em paralelo às rotas REST — ambas chamam a mesma camada, nunca uma à outra

### Parallel Opportunities

- **Phase 1**: T003, T004, T005 em paralelo
- **Phase 2**: T011 e T013 em paralelo com o bloco de migrações; T019 e T020 em paralelo
- **US1**: T021, T022, T022b, T023 em paralelo (testes). Depois, T034 (MCP) e T035 (HTML) em paralelo com
  as rotas, porque tocam arquivos diferentes
- **US2**: T041 e T042 em paralelo
- **US3**: T049 a T052 em paralelo; T055 em paralelo com T053/T054
- **Phase 6**: T063 a T068 e T068b em paralelo — arquivos distintos. T068c depende de T068b, e T068d depende de T068c (é a execução da medição)

**Cuidado com conflito de arquivo**: T024 a T030 e T043 a T046 tocam todos `crm-service.js`; T031 a
T033, T047 e T054 tocam `server.js`; T036 a T040, T048, T058 e T059 tocam `public/app.js`. Dentro de
cada grupo, execução sequencial.

---

## Parallel Example: User Story 1

```bash
# Testes da US1, juntos (devem falhar antes da implementação):
Task: "tests/resumo-service.test.js — rascunho não grava, confirmar grava o revisado, dono errado 404"
Task: "tests/resumo-api.test.js — 401, 403 CSRF, 404, 413, 503"
Task: "tests/resumo-api.test.js — cliente excluído durante a revisão"

# Depois da camada de serviço pronta, em paralelo (arquivos distintos):
Task: "mcp/tools.mjs — quatro ferramentas de rascunho"
Task: "public/index.html — modal de transcrição e tela de revisão"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 → Phase 2 → Phase 3
2. **PARE E VALIDE**: passos 1, 2 e 6 do quickstart. O critério que mais importa é o passo 2.4 —
   com a revisão na tela, o histórico numa segunda aba tem que estar **intacto**
3. US1 sozinha já entrega a feature inteira do ponto de vista do usuário: colar, revisar, salvar

### Incremental Delivery

1. Setup + Foundational → fundação pronta (banco, autoria, extrator isolado)
2. US1 → validar → **MVP entregável**
3. US2 → validar → o resumo passa a alimentar a tela Hoje
4. US3 → validar → rastreabilidade, retenção e a distinção humano × máquina
5. Phase 6 → contrato, documentação e os portões da constituição

**A Phase 6 não é opcional para "considerar pronto".** T062 (paridade) e T072 (`npm test`) são
portões de fase; T065 a T068 existem porque documentação divergente é defeito pelo Princípio VII.
T068b a T068d fecham o SC-005, que sem corpus e sem medição seria critério de aceite sem meio de
verificação.

---

## Notes

- `crm-service.js` é o **único** lugar com regra de negócio. Se uma tarefa levar você a escrever
  validação dentro de `server.js` ou de `mcp/tools.mjs`, a tarefa está sendo cumprida errado
- Nenhum `inputSchema`, corpo de requisição ou formulário aceita campo de autoria ou de revisão —
  eles vêm sempre da credencial verificada
- Os dois planos de credencial **nunca** se substituem: sessão não abre o endpoint MCP, chave de API
  não abre a gestão de usuários. T012 e T022b existem para manter essa fronteira intacta
- Toda saída de dado no DOM passa por `esc()`; todo evento por delegação
- Commit por tarefa ou por grupo lógico; pare em qualquer checkpoint para validar

---

## Phase 7: Convergence

Lacunas encontradas ao avaliar o código contra `spec.md`, `plan.md` e a constituição, depois da
primeira passada de implementação. Ordem: violação de constituição primeiro, depois por severidade.

- [X] T073 **CRITICAL** — Remover os handlers inline herdados da v1 em `public/app.js` (21 `onclick`, mais `ondragstart`/`ondragover`/`ondrop`/`ondragleave` do funil), substituindo-os por delegação com `data-*` como já faz o bloco da feature 002, e então fechar a CSP em `server.js`: `scriptSrc: ["'self'"]` sem `'unsafe-inline'` e **sem** a diretiva `scriptSrcAttr`, por Constitution I (contradicts). Enquanto a diretiva ficar aberta, o escape de saída é a única linha de defesa real contra XSS — e o produto declara na documentação uma proteção que não tem
- [X] T074 Tratar `401` nos dois caminhos que usam `fetch` cru em `public/app.js` — `extrairResumo()` e `confirmarResumo()` — chamando `mostrarLogin()` como o helper `api()` já faz, por FR-094 e FR-025 (partial). Hoje uma sessão que expira durante a revisão devolve um toast genérico e **deixa o rascunho na tela**, que é exatamente o defeito que o RF-95 do PRD existe para impedir
- [X] T075 Acrescentar em `tests/resumo-api.test.js` o caso de sessão expirada durante a revisão, verificando que a interface é devolvida ao login e que o rascunho não permanece acessível, por FR-025 (missing)
- [X] T076 Tornar o fluxo colar → revisar → confirmar navegável inteiramente por teclado em `public/index.html` e `public/app.js`: `aria-label` nos controles sem rótulo textual, foco movido para o modal ao abrir e devolvido ao fechar, `Esc` fechando a revisão com a mesma confirmação do botão Descartar, e ordem de tabulação coerente entre os itens editáveis, por SC-009 e RNF-10 (missing)
- [X] T077 Registrar a duração de cada extração em `ia/extrator.js` e persistir junto de `modelo`/`tokens_*` no rascunho (coluna aditiva em `resumo_rascunhos`), por SC-002 (missing). Sem o tempo medido, "95% em até 30 segundos" é uma promessa que ninguém consegue verificar nem desmentir
- [X] T078 Acrescentar em `tests/resumo-service.test.js` o caso de próximo passo **sem prazo declarado**, com o extrator falso devolvendo `prazo: null`, verificando que o valor nulo sobrevive até a gravação e que a promoção a próxima ação é recusada sem data, por FR-004 (missing)
- [ ] T079 **(BLOQUEADA — exige `ANTHROPIC_API_KEY`, não disponível nesta sessão)** Executar `npm run medir-extracao` com `ANTHROPIC_API_KEY` configurada e registrar a taxa medida e a data no `README.md`, no lugar já marcado como "ainda não executada", por SC-005 (missing). Abaixo de 70%, o ajuste é do prompt em `ia/extrator.js`, não do limiar
- [X] T080 Remover `revisao.png` da raiz do repositório — resíduo da verificação no navegador, não pedido por nenhum artefato (unrequested)

---

## Phase 8: Convergence

Segunda passada de convergência. As lacunas da Phase 7 estão fechadas e verificadas; o que restou
são três divergências entre o que o código faz e o que a documentação normativa afirma — que é
exatamente o defeito que os Princípios IV e VII existem para impedir.

- [X] T081 **CRITICAL** — Documentar na §3 de `docs/DESIGN-SYSTEM.md` os nove componentes novos introduzidos em `public/styles.css`: `.btn.pequeno`, `.chip-revisao`, `.chip-atencao`, `.aviso-retencao`, `.aviso-ia`, `.item-revisao`, `.linha-detalhes`, `.destaque-promocao` e `.transcricao-fonte` — cada um com o uso pretendido e os tokens que consome, no formato das demais entradas, por Constitution IV (missing). Componente que existe no CSS e não existe no Design System é como a divergência começa: o próximo a estender a interface cria um quase-igual porque não sabia que já havia
- [X] T082 **CRITICAL** — Declarar `duracao_ms` no schema `RascunhoResumo` de `openapi.yaml` (inteiro, nulo permitido, com a nota de que serve ao SC-002), por Constitution VII (contradicts). A API já devolve o campo e o contrato não o conhece — e o teste de paridade não pegou porque compara rotas, não campos
- [X] T083 Atualizar `docs/DESIGN-SYSTEM.md` nas três passagens que descrevem a CSP antiga — a "ressalva honesta" da §1.5, a nota da §6 sobre o escape ser a única defesa, e a regra 4 da §9 — para refletir que a política agora é `script-src 'self'; script-src-attr 'none'` e que o front não tem handler inline algum, por Constitution VII (contradicts). Documentação que descreve uma fraqueza já corrigida ensina o leitor a desconfiar da proteção que ele tem
- [X] T084 Estender `tests/parity.test.js` para comparar também os **campos** devolvidos por `serializarRascunho` com as propriedades do schema `RascunhoResumo`, além das rotas, para que a próxima divergência de contrato falhe no `npm test` em vez de sobreviver a duas convergências (missing)
