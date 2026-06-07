<!--
Sync Impact Report
==================
Version change: 1.0.0 → 2.0.0
Bump rationale: MAJOR. A feature 002 (SaaS multi-tenant) redefine de forma incompatível o
Princípio I (de "ferramenta pessoal de dono único" para "produto SaaS multi-tenant") e troca um
item travado da stack (SQLite single-file → PostgreSQL com Row-Level Security). Ambos exigem MAJOR
pela regra de governança (remoção/redefinição incompatível de princípio + substituição de stack).

Modified principles:
  - I. Simplicidade Sob Medida (MVP-First) → reformulado para SaaS multi-tenant (mantém o espírito
    YAGNI/menor incremento; persistência passa a PostgreSQL).
  - II. Segurança e Privacidade por Padrão (LGPD-First) → ampliado: múltiplos titulares por org,
    conteúdo de WhatsApp, dados de pagamento, sub-processadores de IA.
  - III. Interface Dupla — Pessoas e IA (API-First) → agora POR ORGANIZAÇÃO (cada cliente tem o seu
    próprio agente/chaves, isolado à sua org).
  - IV. Auditoria Confiável e Autenticada → mantido, agar com org_id no registro.

Added principles:
  - V. Isolamento Multi-Tenant por Padrão (NEW)
  - VI. Integridade de Cobrança e Direito de Acesso (NEW)
  - VII. Custo de IA Governado (NEW)

Renumbered:
  - "Documentação como Contrato Vivo" (era V) → VIII.

Added/Updated sections:
  - Restrições Técnicas & Stack → PostgreSQL + RLS, migrações versionadas, fila em Postgres,
    pagar.me, provider de WhatsApp abstraído, Anthropic Claude; novas variáveis de ambiente.
  - Fluxo de Desenvolvimento & Portões de Qualidade → portão de isolamento multi-tenant, webhooks
    idempotentes/assinados, revisão de segurança antes de dados reais de múltiplos clientes.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check + Complexity Tracking continuam
    genéricos; alinhado.
  - ✅ .specify/templates/spec-template.md — sem seções obrigatórias novas; alinhado.
  - ✅ .specify/templates/tasks-template.md — categorias já cobrem os novos portões; alinhado.
  - ✅ CLAUDE.md — aponta para o plano corrente; alinhado.

Follow-up TODOs:
  - A feature 001 (MCP) será estendida para carregar `org_id` na credencial (escopo por organização);
    rastreado em specs/002-saas-multitenant/.
-->

# Mini CRM → SaaS de CRM com IA — Constitution

## Core Principles

### I. Simplicidade Sob Medida (MVP-First)

Toda funcionalidade DEVE começar pelo menor incremento que já resolve uma dor real do cliente;
adições "porque um dia pode ser útil" são proibidas (YAGNI). O produto deixou de ser uma ferramenta
de dono único e passou a ser um **SaaS multi-tenant** (várias organizações pagantes na mesma
instância); a simplicidade é medida agora pelo menor número de partes móveis que entrega o SaaS com
segurança, não pela ausência de multi-tenancy. O frontend DEVE permanecer em HTML/CSS/JS puro servido
de `public/`, sem framework nem etapa de build, enquanto isso atender ao escopo; trocar isso exige
justificativa na Complexity Tracking do plano. Cada dependência ou serviço externo novo DEVE resolver
um problema concreto que código próprio simples não resolveria bem.

**Rationale:** o valor do produto é resolver o funil de vendas de consultores/pequenas empresas com
IA, não exibir sofisticação técnica; complexidade desnecessária custa manutenção e margem.

### II. Segurança e Privacidade por Padrão (LGPD-First)

TODOS os endpoints autenticados (inclusive leitura, export e webhooks de terceiros) DEVEM verificar
credencial e contexto de organização — sem exceção; ausência de credencial válida → `401`. Senhas DEVEM
usar hash forte (`bcrypt`); chaves, tokens e segredos de webhook DEVEM ser guardados apenas como hash e
comparados em tempo constante. Todo acesso ao banco DEVE usar prepared statements; escritas DEVEM aplicar
whitelist de campos, validar enums e limitar tamanho de payload. **Dados de cartão NÃO DEVEM transitar
nem ser armazenados pelo nosso servidor** (tokenização no cliente / checkout do provedor — escopo PCI
mínimo). Webhooks de pagamento e de WhatsApp DEVEM ter **assinatura/segredo verificados** e ser
**idempotentes**. Os direitos do titular — exportar e excluir os dados de um cliente — DEVEM permanecer
disponíveis, **por organização**. Em produção, HTTPS é obrigatório, com cookies `Secure` + HSTS,
`helmet` (CSP) e rate limiting ativos. Conteúdo de conversas só é enviado a sub-processadores de IA que
**não treinam** com os dados; o mínimo necessário é enviado.

**Rationale:** o sistema agora concentra dados pessoais de muitos titulares de múltiplas organizações,
conteúdo de WhatsApp e o fluxo financeiro de clientes pagantes — o raio de impacto de uma falha é muito
maior do que no MVP de dono único.

### III. Interface Dupla — Pessoas e IA (API-First), por Organização

Toda capacidade de negócio DEVE ser exposta via API/MCP autenticados, para que automações e agentes de
IA operem o CRM sem depender da UI. **Cada organização tem o seu próprio plano de máquina**: chaves de
API/MCP emitidas e revogáveis pela própria org, **escopadas àquela org** — o agente de um cliente nunca
enxerga os dados de outro. Pessoas usam sessão em cookie `httpOnly` + CSRF; máquinas usam
`Authorization: Bearer`. Credenciais de máquina NÃO DEVEM aparecer no navegador; credenciais de usuário
NÃO DEVEM ser reutilizadas por automações; nenhuma credencial concede acesso fora da sua organização.

**Rationale:** "cada cliente pode ter o seu próprio agente conectado" é um requisito do produto; tratar
o plano de máquina como cidadão de primeira classe **e** isolá-lo por org evita vazamento entre tenants.

### IV. Auditoria Confiável e Autenticada

A identidade do autor de cada escrita (`created_by`, `gerado_por_ia`) DEVE ser derivada do tipo de
credencial autenticada — sessão → `humano`, chave/MCP → `ia` — e NUNCA de um header ou campo do corpo
controlado pelo cliente. Cada registro DEVE gravar a **organização**, quem o criou e quando. As chaves
de API DEVEM ser revogáveis individualmente e registrar o último uso. Eventos sensíveis (mudança de
plano, conexão/desconexão de WhatsApp, exclusão LGPD) DEVEM ser auditados.

**Rationale:** uma trilha de auditoria que o cliente pode falsificar não tem valor; em multi-tenant a
auditoria também precisa amarrar cada ação à organização correta.

### V. Isolamento Multi-Tenant por Padrão

Toda tabela de domínio DEVE carregar `org_id`; nenhuma consulta de dados de tenant DEVE rodar sem o
contexto de organização aplicado. O isolamento DEVE ser imposto **no banco** (PostgreSQL Row-Level
Security), não apenas na camada de aplicação — uma falha de código não pode, sozinha, vazar dados entre
organizações (defesa em profundidade). O papel de banco usado pela aplicação DEVE estar sujeito às
políticas RLS (sem `BYPASSRLS`). O padrão é **negar**: sem `org` no contexto da transação, a leitura
retorna vazio e a escrita falha. Qualquer consulta cross-tenant legítima (operador/billing) DEVE ser
explícita, restrita e auditada.

**Rationale:** o maior risco de um SaaS de CRM é um tenant ver os dados de outro; impor o isolamento no
banco torna o vazamento improvável mesmo diante de bugs na aplicação.

### VI. Integridade de Cobrança e Direito de Acesso

O acesso de uma organização aos recursos (limites e features de plano) DEVE derivar do **estado de
assinatura verificado** junto ao provedor de pagamento (pagar.me), atualizado por webhooks
**assinados e idempotentes** — nunca de um valor enviado pelo cliente. Limites de plano (ex.: número de
clientes) e features (ex.: WhatsApp com IA) DEVEM ser impostos **no servidor**, a cada uso. Falha de
pagamento DEVE seguir uma política explícita (período de carência → suspensão), e o
upgrade/downgrade/cancelamento DEVE refletir nas permissões de forma previsível. Nenhuma feature paga
DEVE ser liberada apenas por sinal vindo do front.

**Rationale:** receita e justiça entre planos dependem de o servidor ser a única fonte de verdade sobre
o que cada organização pode fazer.

### VII. Custo de IA Governado

O modelo de IA DEVE ser escolhido **pela tarefa** — o mais barato que resolve bem (classificação/
sentimento/triagem → Haiku; chat/resumo/redação → Sonnet; raciocínio complexo/escalado → Opus). O
sistema DEVE preferir, quando aplicável, redução de custo nativa (cache de prompt, processamento em
lote para jobs não interativos) e DEVE **medir e limitar** o consumo por organização (orçamento por
plano), degradando ou enfileirando antes de estourar custo. Os identificadores de modelo DEVEM ficar em
configuração (trocáveis sem reescrever lógica). Nenhum caminho DEVE permitir gasto de IA ilimitado por
requisição ou por tenant.

**Rationale:** a margem do SaaS depende diretamente do custo de inferência; rotear por tarefa e medir
por tenant é o que mantém o produto lucrativo à medida que cresce.

### VIII. Documentação como Contrato Vivo

A API DEVE ter um contrato OpenAPI (`openapi.yaml`) mantido em sincronia com o comportamento real e
servido para consulta (Swagger UI em `/api-docs`). Os contratos de integração (pagar.me, WhatsApp, IA,
multi-tenancy) DEVEM ser documentados em `specs/**/contracts/` e atualizados junto com qualquer mudança
de comportamento, schema ou regra. README, dicionário de dados e avaliação de segurança DEVEM ser
atualizados no mesmo conjunto de alterações que muda o comportamento.

**Rationale:** clientes, agentes de IA e integrações de terceiros consomem o contrato documentado;
documentação divergente do código produz integrações quebradas e mina a confiança.

## Restrições Técnicas & Stack

- **Runtime:** Node.js 20 LTS + Express (CommonJS, `type: commonjs`); ponto de entrada `server.js`.
  Código que exige ESM (ex.: SDKs) é carregado por `import()` dinâmico, como já feito no MCP.
- **Persistência:** **PostgreSQL** via `pg`, com **Row-Level Security** habilitado em toda tabela de
  tenant e **migrações versionadas** (`node-pg-migrate`). Substitui o SQLite single-file da v1; a
  justificativa (concorrência de webhooks/jobs + isolamento no banco) fica registrada na Complexity
  Tracking do plano que introduz a mudança.
- **Assíncrono / filas:** trabalho em background (ingestão de WhatsApp, jobs de IA, reconciliação de
  cobrança) usa uma **fila baseada em Postgres** (`pg-boss`) — sem novo datastore (sem Redis) até que
  escala comprovada justifique, com registro na Complexity Tracking.
- **Pagamentos:** **pagar.me** (assinaturas/planos), com webhooks assinados e idempotentes; cartão
  tokenizado no cliente ou checkout hospedado (escopo PCI mínimo — nenhum PAN no nosso servidor).
- **WhatsApp (não oficial):** atrás de uma **abstração de provider** (interface única) com adapters
  para **Evolution API** e **Z-API**; uma linha por organização; recurso exclusivo do plano VIP.
- **IA:** **Anthropic Claude** (Haiku/Sonnet/Opus) roteado por tarefa; IDs de modelo em configuração;
  consumo medido por organização.
- **Autenticação e segurança:** `bcryptjs`, `cookie-parser`, `crypto` nativo; `helmet` (CSP) e
  `express-rate-limit` obrigatórios; segredos de webhook verificados em tempo constante.
- **Frontend:** HTML/CSS/JS puro em `public/`, sem framework e sem build, enquanto atender ao escopo.
- **Configuração por ambiente:** segredos vivem só em `.env` (nunca versionado). Variáveis reconhecidas
  incluem (além das atuais): `DATABASE_URL`, `PAGARME_API_KEY`, `PAGARME_WEBHOOK_SECRET`,
  `ANTHROPIC_API_KEY`, `WHATSAPP_PROVIDER`, `EVOLUTION_URL`/`EVOLUTION_API_KEY`,
  `ZAPI_*`, `APP_URL`.
- **Deploy:** container(es) Docker atrás do Traefik (rede `web`), TLS/HTTPS no proxy, `NODE_ENV=production`
  ativando cookies `Secure` + HSTS; PostgreSQL como serviço/instância gerenciada; webhooks expostos por
  HTTPS público via Traefik.
- Substituir qualquer item desta stack DEVE ser registrado na Complexity Tracking do plano da feature,
  com a alternativa simples e o motivo da rejeição.

## Fluxo de Desenvolvimento & Portões de Qualidade

- O desenvolvimento segue o fluxo Spec Kit: **constitution → specify → plan → tasks → implement**; cada
  feature nasce de uma especificação antes do código.
- O **Constitution Check** do plano DEVE passar antes da Phase 0 e ser reverificado após o design;
  violações vão para a Complexity Tracking com justificativa explícita.
- **Portão de isolamento multi-tenant:** antes de marcar concluída qualquer feature que toque dados de
  tenant, uma verificação DEVE provar que uma organização **não** consegue ler/escrever dados de outra
  (teste negativo de RLS), e que toda tabela nova tem `org_id` + política RLS.
- **Portão de cobrança:** webhooks de pagamento DEVEM ser assinados, idempotentes e ter o mapeamento
  estado de assinatura → permissões verificado; nenhuma feature paga liberada sem estado verificado.
- Antes de tocar em dados reais de **múltiplos** clientes, uma revisão de segurança DEVE confirmar a
  aderência aos Princípios II, IV, V e VI.
- Toda escrita DEVE validar a entrada e responder com códigos HTTP e mensagens de erro consistentes
  (`{ "erro": "..." }`).
- Mudanças DEVEM ser verificadas — rodando o app e/ou exercitando os endpoints — antes de concluídas;
  migrações de banco DEVEM ser revisadas e reversíveis; os commits seguem os hooks de git do Spec Kit.

## Governance

Esta constituição supersede outras práticas; em caso de conflito entre uma decisão pontual e um
princípio aqui descrito, o princípio prevalece. Emendas exigem: registro neste arquivo, justificativa,
incremento de versão e propagação aos artefatos dependentes (templates de plan/spec/tasks e documentos
afetados).

Versionamento segue semântica explícita:

- **MAJOR:** remoção ou redefinição incompatível de um princípio ou de regra de governança, ou
  substituição de um item travado da stack.
- **MINOR:** novo princípio/seção, ou expansão material de orientação existente.
- **PATCH:** clarificações, ajustes de redação e correções não semânticas.

Conformidade: todo plano e toda revisão de mudança DEVEM verificar a aderência aos princípios;
complexidade fora do padrão DEVE ser justificada na Complexity Tracking. Para orientação de runtime
durante o desenvolvimento, os agentes consultam `CLAUDE.md` e o plano corrente da feature.

**Version**: 2.0.0 | **Ratified**: 2026-06-06 | **Last Amended**: 2026-06-07
