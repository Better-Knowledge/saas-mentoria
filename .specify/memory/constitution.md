<!--
Sync Impact Report
==================
Version change: 1.0.0 → 2.0.0
Bump rationale: MAJOR. Os princípios foram renumerados (segurança passa a ser o
Princípio I, por decisão explícita de "segurança de dados em primeiro lugar"),
dois princípios da v1 foram redefinidos e dois princípios novos entraram com
regras não negociáveis que antes não existiam (reuso obrigatório; camada de
domínio única com paridade REST↔MCP). Qualquer citação por número da
constituição v1 precisa ser remapeada — ver tabela abaixo.

Mapeamento de renumeração (v1 → v2):
  I.   Simplicidade Sob Medida (MVP-First)        → VI.  Simplicidade Sob Medida (YAGNI)
  II.  Segurança e Privacidade por Padrão         → I.   Segurança e Privacidade por Padrão (LGPD-First)
  III. Interface Dupla — Pessoas e IA (API-First) → II.  Dois Planos de Credencial — Pessoas e IA
  IV.  Auditoria Confiável e Autenticada          → III. Auditoria Confiável e Autenticada
  V.   Documentação como Contrato Vivo            → VII. Documentação como Contrato Vivo e Verificado

Princípios adicionados:
  - IV. Reuso Antes de Reescrita
  - V.  Camada de Domínio Única e Paridade de Interfaces

Seções alteradas:
  - Restrições Técnicas & Stack — alinhada à stack aprovada no PRD §7.1
    (Node 20 LTS, Express 4, better-sqlite3/WAL, @modelcontextprotocol/sdk,
    Scalar local, zod, node:test + supertest) e à estrutura de arquivos §7.2.
  - Fluxo de Desenvolvimento & Portões de Qualidade — incorpora as fases F0–F8
    do PRD §13 e os portões de teste/segurança do PRD §14.
  - Governance — acrescenta a regra de precedência do Princípio I e a
    obrigação de remapear citações numéricas.

Seções removidas: nenhuma.

Artefatos dependentes:
  - ✅ .specify/templates/plan-template.md — "Constitution Check" e Complexity
    Tracking referenciam a constituição genericamente; segue válido, sem mudança.
  - ✅ .specify/templates/spec-template.md — alinhado, sem mudança.
  - ✅ .specify/templates/tasks-template.md — alinhado, sem mudança.
  - ⚠ docs/SEGURANCA.md — as revisões de 06/06/2026 e 16/08/2026 citam
    "Princípio II" (segurança) e "Princípio IV" (auditoria) pela numeração v1.
    São registros históricos e permanecem válidos como tal; use a tabela de
    mapeamento acima ao lê-los. Nenhuma reescrita retroativa é exigida.
  - ✅ CLAUDE.md — aponta para o plano corrente; alinhado.

Follow-up TODOs: nenhum.
-->

# Mini CRM — Consultoria & IA Generativa Constitution

## Core Principles

### I. Segurança e Privacidade por Padrão (LGPD-First) — NÃO NEGOCIÁVEL

Este é o princípio de maior precedência: quando qualquer outro princípio, prazo ou conveniência
de implementação conflitar com ele, ele prevalece.

- **Nenhuma rota de dados anônima.** TODOS os endpoints `/api/*` e o endpoint `POST /mcp`, inclusive
  leitura e export, DEVEM exigir credencial válida; ausência de credencial → `401`. NÃO DEVE existir
  modo "sem token = liberado". A única exceção permitida é `GET /health`, que NÃO DEVE expor dado de
  negócio.
- **Segredos só como hash.** Senhas com `bcrypt` (custo ≥ 12, mínimo de 8 caracteres, nunca
  retornadas pela API); chaves de API guardadas apenas como hash SHA-256, exibidas uma única vez na
  criação, revogáveis individualmente. Comparação de segredo DEVE ser em tempo constante
  (`crypto.timingSafeEqual`).
- **Entrada e saída defendidas.** 100% das consultas por prepared statements; escritas com whitelist
  explícita de campos (sem mass assignment), enums validados em TODOS os caminhos de escrita e
  payload limitado a 64 KB. Todo dado vindo do banco DEVE passar por uma função de escape única
  antes de entrar no DOM — o front monta HTML a partir de dados que uma IA pode ter escrito.
- **CSP que vale de verdade.** `script-src 'self'`, sem `'unsafe-inline'` e sem `script-src-attr`.
  Isso implica proibição de handler inline no HTML (`onclick`, `ondragstart`, `ondrop`): eventos por
  delegação, um listener por região, `data-*` para identificar o alvo. Nenhum script, fonte ou
  bundle de CDN — nem para a página de documentação.
- **Sessão e transporte.** Sessão em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção,
  expiração de 7 dias, revogável; token CSRF exigido em toda escrita vinda do navegador. NENHUMA
  credencial em `localStorage` ou `sessionStorage`. Em produção: HTTPS obrigatório, HSTS ativo, TLS
  terminado no proxy com redirecionamento HTTP→HTTPS.
- **Falha fechada e silenciosa para fora.** Rate limiting em três níveis (geral, login agressivo,
  MCP). Handler global de erros: exceção não tratada vira `500` genérico sem derrubar o processo; a
  mensagem real vai para o log estruturado. Nenhum dado pessoal e nenhum segredo em log.
- **Direitos do titular.** Exportar e excluir permanentemente todos os dados de um cliente DEVEM
  permanecer disponíveis por REST e por MCP, com política de retenção documentada.

**Rationale:** o sistema guarda dados pessoais e sigilo comercial sujeitos à LGPD, inclusive de
clientes do setor público. Segurança aqui não é um requisito entre outros — é a condição para o
produto ter permissão de tocar em dados reais.

### II. Dois Planos de Credencial — Pessoas e IA

Toda capacidade de negócio DEVE ser alcançável por automação autenticada, para que agentes de IA
operem o CRM sem depender da UI. Pessoas e máquinas DEVEM usar planos de credencial distintos e não
intercambiáveis: sessão em cookie `httpOnly` + token CSRF para a interface; API keys
`Authorization: Bearer`, uma por integração e revogáveis individualmente, para automações. O MCP
DEVE reaproveitar as chaves já emitidas na tela Integrações — NÃO DEVE existir plano de credencial
paralelo — e a resolução de credencial DEVE ficar isolada atrás de uma única função, para que OAuth
possa ser plugado depois sem invalidar as chaves existentes. Credenciais de máquina NÃO DEVEM
aparecer no navegador; credenciais de usuário NÃO DEVEM ser reutilizadas por automações. Gestão de
usuários NÃO DEVE ser exposta por MCP: máquinas operam o CRM, não administram contas humanas.

**Rationale:** o dono trabalha sozinho e quer integrar IA desde o MVP; tratar os dois planos como
cidadãos de primeira classe evita remendos e vazamento de credencial entre navegador e automação.

### III. Auditoria Confiável e Autenticada

A identidade do autor de cada escrita (`created_by`, `gerado_por_ia`) DEVE ser derivada do tipo de
credencial efetivamente verificada — sessão → `humano`, API key → `ia` — e NUNCA de header, corpo
de requisição ou `inputSchema` de ferramenta MCP. Nenhum schema de entrada, REST ou MCP, PODE aceitar
campos de autoria. Cada registro DEVE gravar quem criou e quando. Alterações DEVEM produzir trilha
de auditoria com entidade, id, campo, valor anterior, valor novo, autor, credencial usada e
timestamp. A trilha DEVE ser somente leitura pela aplicação: sem endpoint de edição ou exclusão. As
chaves de API DEVEM registrar `ultimo_uso`.

**Rationale:** uma trilha que o cliente pode falsificar não tem valor. Com IA escrevendo no banco, a
única prova de origem confiável é a credencial verificada no servidor.

### IV. Reuso Antes de Reescrita

Criar algo novo exige antes demonstrar que o existente não serve.

- **Stack congelada.** A stack da seção "Restrições Técnicas & Stack" é a decisão vigente. Trocar,
  acrescentar ou remover item dela DEVE ser registrado na Complexity Tracking do plano, com a
  alternativa simples e o motivo da rejeição.
- **Domínio.** Regra de negócio nova entra em `crm-service.js`; rotas REST e ferramentas MCP
  consomem, nunca reimplementam.
- **Interface.** Telas DEVEM ser montadas com os componentes já definidos no Design System
  (`.btn`, `.aba`, `.stat-card`, `.item`, `.cartao`, `.coluna`, `.modal`, `.campo`, `.toast`,
  `.dropdown`, `.vazio`, entre outros). Componente novo só quando nenhum existente cobre o caso, e
  DEVE ser documentado em `DESIGN-SYSTEM.md` no mesmo conjunto de alterações.
- **Estilo.** NENHUM valor cru de cor, raio, sombra, espaçamento ou tipografia PODE aparecer em
  regra de componente — usa-se o token; se falta um token, cria-se o token em `:root`.
- **Contrato.** Schemas do OpenAPI são reusados via `components/` (`schemas`, `parameters`,
  `responses`), sem repetição de estrutura inline; os `inputSchema` das ferramentas MCP derivam da
  mesma fonte.
- **Dados.** Tabelas e nomenclatura existentes são preservadas; migrações são aditivas e
  idempotentes. Renomear entidade já publicada (ex.: `Lead` no contrato, `clientes` no banco) quebra
  integrações emitidas e NÃO DEVE ser feito por preferência estética.

**Rationale:** o produto está sendo reconstruído, não inventado do zero. Duplicar regra, componente
ou schema é como divergências de comportamento e falhas de segurança nascem — uma cópia é corrigida
e a outra não.

### V. Camada de Domínio Única e Paridade de Interfaces

NENHUMA regra de negócio PODE existir fora de `crm-service.js`. As rotas REST traduzem HTTP; as
ferramentas MCP traduzem JSON-RPC; ambas chamam a mesma camada, onde vivem validação, whitelist,
enums e auditoria. Toda operação de negócio disponível por REST DEVE ter ferramenta MCP equivalente
— incluindo exportar e excluir — e ferramentas destrutivas DEVEM declarar a irreversibilidade na
própria `description` e nas `annotations` (`readOnlyHint`, `idempotentHint`, `destructiveHint`,
`openWorldHint`). Erros de domínio DEVEM chegar ao agente com a mesma mensagem da API. Se REST e MCP
se comportarem diferente diante da mesma entrada, é defeito, não variação aceitável.

**Rationale:** duas portas para os mesmos dados só é seguro se houver uma tranca só. Lógica
duplicada em `mcp/` significa que uma validação vai ser esquecida exatamente no caminho que a IA usa.

### VI. Simplicidade Sob Medida (YAGNI)

Um processo, um deploy, um banco. Toda funcionalidade DEVE começar pelo menor incremento que resolve
uma dor real; adições "porque um dia pode ser útil" são proibidas. Necessidade nova que aparece
durante a construção vira linha no `ROADMAP.md`, não puxadinho no código. O front-end DEVE
permanecer em HTML/CSS/JS puros servidos de `public/`, sem framework, sem CDN e sem etapa de build,
enquanto isso atender ao escopo. Cada dependência nova DEVE resolver um problema concreto que código
próprio simples não resolveria bem, e sua justificativa DEVE estar escrita.

**Rationale:** é uma ferramenta sob medida operada por uma pessoa só. Complexidade que ninguém pediu
custa manutenção, aumenta a superfície de ataque e dilui o valor que justifica o projeto.

### VII. Documentação como Contrato Vivo e Verificado

A API DEVE ter contrato OpenAPI 3.1 em `openapi.yaml`, versionado, cobrindo 100% das rotas públicas,
com `operationId`, `summary`, `description`, `tags`, parâmetros, corpo, todos os códigos de resposta,
o esquema de segurança aplicável e exemplos em toda operação de escrita. O spec DEVE ser validado no
boot — servidor não sobe com OpenAPI inválido — servido cru em `/openapi.yaml` e navegável em
`/docs` por bundle local. A paridade DEVE ser verificada por teste automatizado nos dois eixos: rota
Express ↔ spec (com lista de exclusão explícita, versionada e justificada no próprio arquivo de
teste) e serviço REST ↔ ferramenta MCP. Qualquer mudança de comportamento, schema ou validação DEVE,
no mesmo conjunto de alterações, atualizar `openapi.yaml`, `docs/MCP.md`, `README.md` e os demais
documentos afetados. Documentação desatualizada é defeito, não pendência.

**Rationale:** agentes de IA e integrações consomem o contrato, não o código. Documentação que
diverge do comportamento real produz integração quebrada — e, quando descreve uma proteção que não
existe, produz falsa sensação de segurança.

## Restrições Técnicas & Stack

Stack aprovada (PRD §7.1). Substituir qualquer item exige registro na Complexity Tracking do plano.

- **Runtime:** Node.js 20 LTS + Express 4 (CommonJS); ponto de entrada `server.js`.
- **Persistência:** SQLite via `better-sqlite3`, `journal_mode = WAL`, `foreign_keys = ON`; o arquivo
  do banco vive em `DATA_DIR` (volume em Docker). Migrações aditivas e idempotentes no boot.
- **Autenticação:** `bcryptjs` + `crypto` nativo, sem serviço externo.
- **Segurança:** `helmet` (CSP), `express-rate-limit`, `cookie-parser` — obrigatórios.
- **MCP:** `@modelcontextprotocol/sdk`, transporte Streamable HTTP em `POST /mcp`, no mesmo processo.
- **Validação:** `zod`, para entrada da API e schemas das ferramentas MCP.
- **Documentação:** Scalar (`@scalar/api-reference`) com bundle servido localmente, nunca de CDN.
- **Front-end:** HTML, CSS e JavaScript puros; Design System em custom properties (`styles.css`);
  gráficos em SVG gerado em JavaScript, sem biblioteca.
- **Testes:** `node:test` + `supertest`, sem framework adicional.
- **Deploy:** Docker multi-estágio, execução como usuário não-root, nenhum segredo na imagem,
  `HEALTHCHECK` declarado; Traefik à frente com TLS terminado no proxy.
- **Configuração:** segredos apenas em `.env`, nunca versionado (`ADMIN_EMAIL`, `ADMIN_SENHA`,
  `PORT`, `NODE_ENV`, `DATA_DIR`).
- **Estrutura de arquivos:** conforme PRD §7.2 — `server.js`, `auth.js`, `db.js`, `crm-service.js`,
  `audit.js`, `openapi.yaml`, `mcp/`, `public/`, `scripts/`, `tests/`, `docs/`.
- **Qualidade não funcional:** p95 < 500 ms na escala de milhares de clientes; responsivo de 360 px a
  1920 px sem rolagem horizontal; acessibilidade com navegação completa por teclado, contraste AA e
  `aria-label` em controle sem rótulo textual; comentários em português explicando o **porquê** das
  decisões não óbvias.

## Fluxo de Desenvolvimento & Portões de Qualidade

- O desenvolvimento segue o fluxo Spec Kit: **constitution → specify → plan → tasks → implement**;
  cada feature nasce de uma especificação antes do código.
- O **Constitution Check** do plano DEVE passar antes da Phase 0 e ser reverificado após o design;
  violações vão para a Complexity Tracking com justificativa explícita.
- A construção segue as fases do PRD §13 (F0 Fundação · F1 Autenticação · F2 API REST ·
  F3 OpenAPI+/docs · F4 MCP · F5 Front-end · F6 Dashboard · F7 Endurecimento · F8 Operação). Cada
  fase termina com commit próprio e documentação atualizada no mesmo commit.
- **Portão de testes:** `npm test` verde é condição para concluir qualquer fase. A suíte DEVE cobrir
  camada de serviço, autenticação (sessão, CSRF, chaves, papéis), paridade REST↔MCP e paridade
  rota↔OpenAPI.
- **Portão de segurança:** antes de tocar em dados reais de clientes, uma revisão de segurança DEVE
  confirmar aderência aos Princípios I, II e III e registrar o resultado em `docs/SEGURANCA.md`.
  Achado alto ou crítico em aberto bloqueia a entrega.
- **Portão de reuso:** ao propor componente, schema, tabela ou dependência nova, o plano DEVE
  nomear o existente que foi avaliado e dizer por que não serve.
- Toda escrita DEVE validar a entrada e responder com códigos HTTP e mensagens consistentes
  (`{ "erro": "..." }`).
- Mudanças DEVEM ser verificadas executando o app ou exercitando os endpoints antes de serem
  marcadas como concluídas. Código que não foi executado não está pronto.

## Governance

Esta constituição supersede outras práticas; em caso de conflito entre uma decisão pontual e um
princípio aqui descrito, o princípio prevalece. Entre princípios, o **Princípio I (Segurança e
Privacidade por Padrão)** tem precedência sobre todos os demais: prazo, simplicidade, ergonomia de
interface ou conveniência de implementação não justificam relaxá-lo.

Emendas exigem: registro neste arquivo, justificativa, incremento de versão e propagação aos
artefatos dependentes (templates de plan/spec/tasks e documentos afetados).

Versionamento segue semântica explícita:

- **MAJOR:** remoção, renumeração ou redefinição incompatível de princípio ou de regra de governança.
- **MINOR:** novo princípio/seção, ou expansão material de orientação existente.
- **PATCH:** clarificações, ajustes de redação e correções não semânticas.

Documentos que citarem princípios por número DEVEM indicar a versão da constituição a que se
referem; o Sync Impact Report no topo deste arquivo mantém o mapeamento entre versões.

Conformidade: todo plano e toda revisão de mudança DEVEM verificar a aderência aos princípios;
complexidade fora do padrão DEVE ser justificada na Complexity Tracking. Para orientação de runtime
durante o desenvolvimento, os agentes consultam `CLAUDE.md` e o plano corrente da feature.

**Version**: 2.0.0 | **Ratified**: 2026-06-06 | **Last Amended**: 2026-08-23
