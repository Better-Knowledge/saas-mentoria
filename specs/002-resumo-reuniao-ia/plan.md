# Implementation Plan: Resumo automático de reunião com revisão humana

**Branch**: `002-resumo-reuniao-ia` | **Date**: 2026-08-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-resumo-reuniao-ia/spec.md`

## Summary

A pessoa cola a transcrição de uma reunião na ficha de um cliente; o servidor envia o texto a um
modelo de linguagem e devolve um **rascunho** com resumo, decisões, próximos passos e objeções. Nada
toca o banco de negócio até a confirmação. Ao confirmar, o conteúdo revisado vira **uma interação**
marcada como gerada por IA, a transcrição é guardada por 90 dias, e a próxima ação só muda se a
pessoa promover explicitamente um dos passos.

Abordagem técnica: uma função de domínio nova em `crm-service.js` (`resumoReuniao.*`) consumida
igualmente por REST e MCP; um adaptador isolado em `ia/extrator.js` que é o **único** lugar do
código que fala com o provedor externo; três tabelas novas (`resumo_rascunhos`, `transcricoes`,
`auditoria`) criadas por migração aditiva; e a suíte `node:test` + `supertest` que o produto ainda
não tem, introduzida aqui porque a constituição a exige como portão.

## Technical Context

**Language/Version**: Node.js 20 LTS, JavaScript CommonJS (`"type": "commonjs"`)

**Primary Dependencies**: Express 4, `better-sqlite3` (WAL), `zod`, `helmet`, `express-rate-limit`,
`cookie-parser`, `@modelcontextprotocol/sdk`, `@scalar/api-reference`, `js-yaml` — todas já
instaladas. **Novas**: `@anthropic-ai/sdk` (runtime) e `supertest` (dev).

**Storage**: SQLite, arquivo único em `DATA_DIR`. Três tabelas novas + quatro colunas aditivas em
`interacoes`. Nenhuma tabela existente é alterada destrutivamente.

**Testing**: `node:test` (runner nativo) + `supertest`. É a primeira suíte do repositório — hoje
`package.json` não tem script `test`.

**Target Platform**: container Linux atrás do Traefik, processo único.

**Project Type**: aplicação web de processo único (servidor Express + front estático em `public/`).

**Performance Goals**: p95 < 500 ms nas rotas que não chamam o modelo. A extração é I/O externo:
alvo de 95% em ≤ 30 s, teto rígido de 60 s com cancelamento (SC-002, FR-031).

**Constraints**: CSP `script-src 'self'` sem `'unsafe-inline'`; payload da API limitado a 64 KB —
**a transcrição estoura esse limite**, tratado em research.md como decisão explícita; segredo do
provedor apenas no servidor; nenhum dado pessoal em log.

**Scale/Scope**: um consultor, milhares de clientes, dezenas de transcrições por mês. Volume
irrelevante para desempenho; relevante para **custo por chamada**, que é a variável nova.

## Constitution Check

*GATE: avaliado antes da Phase 0 e reavaliado após a Phase 1.*

Constituição vigente: **v2.0.0** (`.specify/memory/constitution.md`).

| Princípio | Avaliação inicial | Reavaliação pós-design |
|---|---|---|
| **I — Segurança e Privacidade por Padrão** | ⚠ Atenção | ✅ Passa com controles |
| **II — Dois Planos de Credencial** | ✅ Passa | ✅ Passa |
| **III — Auditoria Confiável e Autenticada** | ⚠ Bloqueio de fundação | ✅ Resolvido |
| **IV — Reuso Antes de Reescrita** | ✅ Passa | ✅ Passa |
| **V — Camada de Domínio Única e Paridade** | ✅ Passa | ✅ Passa |
| **VI — Simplicidade Sob Medida** | ❌ **Violação** | ❌ **Violação justificada** — ver Complexity Tracking |
| **VII — Documentação como Contrato Vivo** | ✅ Passa | ✅ Passa |

**I — Segurança e Privacidade.** A feature abre a **primeira saída de rede do produto** e introduz um
segredo novo. Controles que fecham o gate: chave do provedor lida só de `process.env` no servidor e
nunca serializada em resposta (FR-027a); mascaramento de telefone e e-mail antes do envio (FR-005);
transcrição tratada como conteúdo hostil, sem poder virar instrução (research.md §5); saída do modelo
escapada no DOM pelo `esc()` que já existe (FR-023); rate limit próprio na rota de extração, mais
estrito que o geral, porque cada chamada custa dinheiro; retenção de 90 dias com descarte automático
(FR-026a) e apagamento em cascata na exclusão do cliente (FR-026b).

**III — Auditoria.** A spec exige trilha de auditoria (FR-019 a FR-022), e **a tabela `auditoria` não
existe no código hoje** — está prevista no PRD como RF-84 da fundação v2, que ainda não foi
construída. Isto seria bloqueio. Resolução adotada: criar a tabela **exatamente com o schema do PRD
§8.2**, sem inventar variante, e um `audit.js` mínimo que grava apenas os eventos desta feature. É
reuso de decisão já tomada (Princípio IV), não desenho novo — e a fundação v2, quando chegar, herda
a tabela em vez de recriá-la.

**VI — Simplicidade.** Violação real e inevitável: o produto deixa de ser "um processo, um deploy,
um banco, zero dependência externa". Detalhada e justificada na Complexity Tracking.

**VII — Documentação.** `openapi.yaml`, `docs/MCP.md`, `README.md`, `docs/SEGURANCA.md`,
`docs/ROADMAP.md` (F2.1 passa a "em construção") e `docs/DICIONARIO-DADOS-LEADS.md` entram no mesmo
conjunto de alterações. `docs/PRD-Reconstrucao-CRM.md` §4.2 recebe nota de que o item foi promovido.

## Project Structure

### Documentation (this feature)

```text
specs/002-resumo-reuniao-ia/
├── plan.md              # Este arquivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── rest-resumos.md
│   └── mcp-resumos.md
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Gerado por /speckit-tasks — não por este comando
```

### Source Code (repository root)

O repositório é plano por decisão da constituição; a feature respeita o layout do PRD §7.2 e não
introduz diretório de arquitetura novo além de `ia/`, que existe para isolar a dependência externa.

```text
cpdf-crm-mentoria/
├── server.js                  # + 5 rotas REST, + rate limit da extração, + boot da rotina de purga
├── crm-service.js             # + resumoReuniao.*  ← ÚNICO lugar com regra de negócio
├── audit.js                   # NOVO: gravação da trilha (schema do PRD §8.2)
├── db.js                      # + migrações aditivas: 3 tabelas, 4 colunas em interacoes
├── auth.js                    # + resolverBearer / resolverSessao separados (ver research.md §9)
├── ia/
│   └── extrator.js            # NOVO: único ponto de contato com o provedor externo
├── mcp/
│   └── tools.mjs              # + 4 ferramentas, chamando a mesma camada de serviço
├── public/
│   ├── index.html             # + modal de colar transcrição e tela de revisão
│   ├── app.js                 # + estado do rascunho, render da revisão (delegação, sem onclick)
│   └── styles.css             # reuso de .modal .campo .btn .item .vazio .toast — sem token novo
├── scripts/
│   └── purgar-transcricoes.js # NOVO: descarte dos 90 dias, também executável à mão
├── tests/                     # NOVO — primeira suíte do repositório
│   ├── resumo-service.test.js
│   ├── resumo-api.test.js
│   ├── resumo-privacidade.test.js
│   └── parity.test.js
└── openapi.yaml               # + 5 operações, + schemas em components/
```

**Structure Decision**: mantido o layout plano existente. A única pasta nova é `ia/`, justificada por
uma regra de contenção: se amanhã o provedor mudar, ou se a chamada externa precisar ser desligada,
existe **um** arquivo para trocar. `crm-service.js` chama `ia/extrator.js`, nunca o contrário, e o
extrator não conhece SQLite nem HTTP.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **Dependência externa de terceiro (`@anthropic-ai/sdk`) e saída de rede do servidor** — quebra "um processo, um deploy, zero dependência externa" (Princípio VI, RNF-01) | É a feature. A decisão Q1 → A do responsável pelo produto determina que a extração acontece no próprio sistema; sem chamar um modelo não há extração | **Q1 → B (agente externo via MCP entrega o resultado pronto)** mantinha o produto sem dependência, sem segredo e sem custo, e foi explicitamente rejeitada pelo responsável: exigiria configurar um agente fora do CRM, e o usuário não conseguiria colar a transcrição na própria ficha. Implementar extração por heurística local (regex/palavras-chave) foi descartado por não resolver o problema — separar decisão de objeção exige compreensão de linguagem |
| **Segredo novo em ambiente (`ANTHROPIC_API_KEY`)** e superfície de exfiltração inédita | Consequência direta da linha acima | Não há alternativa: chamada autenticada exige credencial. Mitigação: a chave nunca sai de `process.env`, não aparece em `/health`, em log, em erro ou em qualquer resposta (FR-027a), e o produto sobe normalmente sem ela, apenas com a feature indisponível (FR-027b) |
| **Custo variável por uso** — o produto passa a ter um custo operacional que cresce com o uso, algo que nenhuma feature anterior tinha | Inerente a chamar um modelo por API | Teto de gasto foi adotado como mitigação, não como alternativa: limite de tamanho por transcrição, contagem de tokens antes de enviar e rate limit dedicado (research.md §4) |
| **Terceira tabela nova (`resumo_rascunhos`) para estado transitório** | O rascunho precisa sobreviver a um F5 durante a revisão e pertencer a um dono; guardá-lo só na memória do navegador perderia o resultado de uma chamada que **custou dinheiro** | Guardar em memória do processo foi rejeitado: o container reinicia e o rascunho some; e estado em memória não sobrevive a mais de uma instância no futuro. `localStorage` está proibido pelo Princípio I para dado sensível |
| **Rotina periódica dentro do processo** (purga dos 90 dias) | FR-026a exige descarte automático "sem intervenção manual", e a stack não tem agendador | Cron externo foi rejeitado por acrescentar uma peça de infraestrutura fora do container e quebrar "um deploy". A rotina é um `setInterval` diário disparado no boot, com o mesmo trabalho exposto em `scripts/purgar-transcricoes.js` para execução manual e para o teste |

**Nota de honestidade sobre o Princípio VI.** As cinco linhas acima são consequência de **uma** decisão
— extrair dentro do produto. Não é complexidade acidental acumulada por descuido; é o preço, tomado
de olhos abertos, da opção A da Q1. Se em algum momento o custo ou a dependência incomodarem, o
caminho de volta é a opção B, e o desenho aqui deixa esse caminho aberto: `ia/extrator.js` é a única
peça a descartar, porque as rotas de rascunho, revisão e confirmação continuam válidas recebendo o
resultado de fora.
