<!--
Sync Impact Report
==================
Version change: (template / unratified) → 1.0.0
Bump rationale: First concrete ratification of the constitution from placeholder
template. MAJOR baseline established (1.0.0).

Modified principles:
  - [PRINCIPLE_1_NAME] → I. Simplicidade Sob Medida (MVP-First)
  - [PRINCIPLE_2_NAME] → II. Segurança e Privacidade por Padrão (LGPD-First)
  - [PRINCIPLE_3_NAME] → III. Interface Dupla — Pessoas e IA (API-First)
  - [PRINCIPLE_4_NAME] → IV. Auditoria Confiável e Autenticada
  - [PRINCIPLE_5_NAME] → V. Documentação como Contrato Vivo

Added sections:
  - Restrições Técnicas & Stack (SECTION_2)
  - Fluxo de Desenvolvimento & Portões de Qualidade (SECTION_3)
  - Governança preenchida

Removed sections: none

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — "Constitution Check" + Complexity
    Tracking já referenciam a constituição de forma genérica; alinhado, sem mudança.
  - ✅ .specify/templates/spec-template.md — sem seções obrigatórias novas/removidas
    pela constituição; alinhado, sem mudança.
  - ✅ .specify/templates/tasks-template.md — categorias (security hardening, docs)
    já cobrem os princípios; alinhado, sem mudança.
  - ✅ .specify/templates/commands/*.md — diretório inexistente; não aplicável.
  - ✅ CLAUDE.md — aponta para o plano corrente como guia de runtime; alinhado.

Follow-up TODOs: none (RATIFICATION_DATE definida como a data desta ratificação).
-->

# Mini CRM — Consultoria & IA Generativa Constitution

## Core Principles

### I. Simplicidade Sob Medida (MVP-First)

Toda funcionalidade DEVE começar pelo menor incremento que já resolve uma dor real do
usuário; adições "porque um dia pode ser útil" são proibidas (YAGNI). O frontend DEVE
permanecer em HTML/CSS/JS puro servido de `public/`, sem framework nem etapa de build,
enquanto isso atender ao escopo. A persistência DEVE usar um único arquivo SQLite
(`better-sqlite3`); migrar para um banco cliente-servidor exige justificativa registrada na
seção Complexity Tracking do plano. Cada dependência nova DEVE resolver um problema concreto
que código próprio simples não resolveria bem.

**Rationale:** o produto é uma ferramenta pessoal "sob medida" para um consultor que trabalha
sozinho; complexidade desnecessária custa manutenção e dilui o valor que justifica o projeto.

### II. Segurança e Privacidade por Padrão (LGPD-First)

TODOS os endpoints `/api`, inclusive leitura e export, DEVEM exigir autenticação — sem
exceção. NÃO DEVE existir modo "sem credencial = liberado": ausência de credencial válida →
`401`. Senhas DEVEM ser guardadas com hash forte (`bcrypt`); chaves e tokens DEVEM ser
guardados apenas como hash e comparados em tempo constante (`crypto.timingSafeEqual`). Todo
acesso ao banco DEVE usar prepared statements; escritas DEVEM aplicar whitelist de campos
(sem mass assignment), validar enums e limitar tamanho de payload. Os direitos do titular —
exportar e excluir todos os dados de um cliente — DEVEM permanecer disponíveis. Em produção,
HTTPS é obrigatório, com cookies `Secure` + HSTS, `helmet` (CSP) e rate limiting ativos.

**Rationale:** o sistema guarda dados pessoais sujeitos à LGPD (contato, conversas, valores);
segurança não é recurso opcional, é pré-requisito para tocar em dados reais.

### III. Interface Dupla — Pessoas e IA (API-First)

Toda capacidade de negócio DEVE ser exposta via API REST autenticada, para que automações e
agentes de IA operem o CRM sem depender da UI. Pessoas e máquinas DEVEM usar planos de
credencial distintos: sessão em cookie `httpOnly` + token CSRF para a interface; API keys
`Authorization: Bearer`, uma por integração e revogáveis individualmente, para automações.
Credenciais de máquina NÃO DEVEM aparecer no navegador, e credenciais de usuário NÃO DEVEM
ser reutilizadas por automações.

**Rationale:** o dono trabalha sozinho mas quer integrar IA desde o MVP — a UI é para a
pessoa, a API é para a IA; tratar os dois planos como cidadãos de primeira classe evita
remendos posteriores e vazamento de credenciais.

### IV. Auditoria Confiável e Autenticada

A identidade do autor de cada escrita (`created_by`, `gerado_por_ia`) DEVE ser derivada do
tipo de credencial autenticada — sessão → `humano`, API key → `ia` — e NUNCA de um header ou
campo do corpo controlado pelo cliente. Cada registro DEVE gravar quem o criou e quando. As
chaves de API DEVEM ser revogáveis individualmente e registrar o último uso.

**Rationale:** uma trilha de auditoria que o cliente pode falsificar não tem valor; a
confiança vem da credencial efetivamente verificada, não da boa-fé de quem chama a API.

### V. Documentação como Contrato Vivo

A API DEVE ter um contrato OpenAPI (`openapi.yaml`) mantido em sincronia com o comportamento
real e servido para consulta (Swagger UI em `/api-docs`). Qualquer mudança de comportamento
de endpoint, de schema ou de regra de validação DEVE, no mesmo conjunto de alterações,
atualizar o `openapi.yaml` e os documentos afetados (`README.md`, dicionário de dados e, quando
aplicável, PRD e avaliação de segurança).

**Rationale:** a IA e integrações de terceiros consomem o contrato documentado; documentação
divergente do código produz integrações quebradas e mina a confiança na ferramenta.

## Restrições Técnicas & Stack

- **Runtime:** Node.js + Express (CommonJS, `type: commonjs`); ponto de entrada `server.js`.
- **Persistência:** SQLite via `better-sqlite3` com `journal_mode = WAL` e `foreign_keys = ON`;
  o arquivo `crm.db` vive em `DATA_DIR` (volume em Docker; raiz do projeto em dev).
- **Autenticação e segurança:** `bcryptjs`, `cookie-parser` e `crypto` nativo; `helmet` (CSP) e
  `express-rate-limit` (limite geral + limite estrito no login) são obrigatórios.
- **Frontend:** HTML/CSS/JS puro em `public/`, sem framework e sem build.
- **Configuração por ambiente:** segredos vivem apenas em `.env` (nunca versionado). Variáveis
  reconhecidas: `ADMIN_EMAIL`, `ADMIN_SENHA`, `PORT`, `NODE_ENV`, `DATA_DIR`.
- **Deploy:** container Docker atrás do Traefik (rede `web`), com TLS/HTTPS terminado no proxy e
  `NODE_ENV=production` ativando cookies `Secure` + HSTS.
- Substituir qualquer item desta stack DEVE ser registrado na Complexity Tracking do plano da
  feature, com a alternativa simples e o motivo da rejeição.

## Fluxo de Desenvolvimento & Portões de Qualidade

- O desenvolvimento segue o fluxo Spec Kit: **constitution → specify → plan → tasks →
  implement**; cada feature nasce de uma especificação antes do código.
- O **Constitution Check** do plano DEVE passar antes da Phase 0 e ser reverificado após o
  design; violações vão para a Complexity Tracking com justificativa explícita.
- Antes de tocar em dados reais de clientes, uma revisão de segurança DEVE confirmar a aderência
  aos Princípios II e IV (autenticação total, auditoria derivada da credencial).
- Toda escrita DEVE validar a entrada (campos obrigatórios, enums, tamanho de payload) e
  responder com códigos HTTP e mensagens de erro consistentes (`{ "erro": "..." }`).
- Mudanças DEVEM ser verificadas — rodando o app e/ou exercitando os endpoints — antes de serem
  marcadas como concluídas; os commits seguem os hooks de git do Spec Kit.

## Governance

Esta constituição supersede outras práticas; em caso de conflito entre uma decisão pontual e um
princípio aqui descrito, o princípio prevalece. Emendas exigem: registro neste arquivo,
justificativa, incremento de versão e propagação às artefatos dependentes (templates de
plan/spec/tasks e documentos afetados).

Versionamento segue semântica explícita:

- **MAJOR:** remoção ou redefinição incompatível de um princípio ou de regra de governança.
- **MINOR:** novo princípio/seção, ou expansão material de orientação existente.
- **PATCH:** clarificações, ajustes de redação e correções não semânticas.

Conformidade: todo plano e toda revisão de mudança DEVEM verificar a aderência aos princípios;
complexidade fora do padrão DEVE ser justificada na Complexity Tracking. Para orientação de
runtime durante o desenvolvimento, os agentes consultam `CLAUDE.md` e o plano corrente da
feature.

**Version**: 1.0.0 | **Ratified**: 2026-06-06 | **Last Amended**: 2026-06-06
