# Research — SaaS Multi-Tenant (Planos, Cobrança, WhatsApp, IA)

**Feature**: `002-saas-multitenant` · **Date**: 2026-06-07

Decisões técnicas da Fase 0. Avaliadas contra a **Constitution v2.0.0** (Simplicidade, Segurança/LGPD,
Interface Dupla por org, Auditoria, **Isolamento Multi-Tenant**, **Integridade de Cobrança**, **Custo de
IA Governado**, Documentação). As escolhas de fork já confirmadas pelo dono: **PostgreSQL + RLS**,
**abstração de WhatsApp** sobre Evolution/Z-API, **artefatos Spec Kit**. Sem marcadores
`NEEDS CLARIFICATION` pendentes; as decisões antes em aberto estão em "Decisões confirmadas".

---

## D1 — Modelo de multi-tenancy: banco compartilhado + `org_id` + RLS

- **Decision**: Um único banco PostgreSQL **compartilhado**; toda tabela de tenant carrega `org_id`
  (UUID); o isolamento é imposto por **Row-Level Security**. A aplicação conecta com um papel **sem
  `BYPASSRLS`**; cada transação define `SET LOCAL app.current_org = '<uuid>'` e as políticas filtram
  `org_id = current_setting('app.current_org')::uuid`. O padrão é **negar**: sem o setting, leitura
  retorna vazio e escrita falha.
- **Rationale**: É o padrão de SaaS multi-tenant que melhor equilibra simplicidade operacional (um
  banco, um backup, migração única) com **defesa em profundidade** (um bug de `WHERE` não vaza dados —
  o banco recusa). Atende ao Princípio V e ao SC-001 (zero vazamento) de forma verificável.
- **Alternatives considered**:
  - *Banco/arquivo por tenant (SQLite-por-tenant ou schema-por-tenant)*: rejeitado — isolamento físico
    forte, mas explode a complexidade de migração, backup, pool de conexões e consultas do operador.
  - *Só `WHERE org_id = ?` na aplicação (sem RLS)*: rejeitado — um único `WHERE` esquecido vaza tudo; o
    Princípio V exige imposição no banco.
- **Notas**: usar `gen_random_uuid()` (extensão `pgcrypto`/`pgcrypto`-builtin) para PKs evita
  enumeração de IDs entre tenants. Índices compostos começando por `org_id`.

## D2 — Persistência: `pg` (node-postgres) + pool + helper de transação RLS

- **Decision**: Driver `pg` com um **pool**. Um helper `withOrg(orgId, fn)` abre uma transação, roda
  `SET LOCAL app.current_org = $1`, executa as queries e faz commit/rollback. Operações sem org
  (signup, webhooks antes de resolver a org, operador) usam um helper `withoutOrg`/consultas explícitas.
- **Rationale**: `SET LOCAL` é por transação — casa com pool (não vaza contexto entre conexões
  reutilizadas). Centralizar o contexto em um helper garante que `crm-service.js` nunca rode sem org.
- **Alternatives considered**: ORM (Prisma/Sequelize/Drizzle) — rejeitado para v1 por peso/curva e por
  o projeto preferir SQL explícito; pode ser reconsiderado depois (Complexity Tracking). Conexão por
  request com `SET ROLE` por tenant — rejeitado (gestão de papéis por tenant é mais complexa que `SET
  LOCAL`).

## D3 — Migrações: `node-pg-migrate`

- **Decision**: Migrações versionadas em `migrations/` com `node-pg-migrate` (up/down, tabela de
  controle). Inclui: extensão de UUID, tabelas novas, `org_id` nas existentes, **políticas RLS**,
  índices, e seeds do catálogo de planos.
- **Rationale**: Padrão simples, SQL-first, reversível; a constituição exige migrações revisáveis e
  reversíveis. Evita schema implícito como o `db.exec` atual.
- **Alternatives considered**: `.sql` numerados + runner caseiro (viável, mas reinventa
  controle/rollback); ORM migrations (acopla a um ORM não adotado).

## D4 — Contas, organização ativa e papéis

- **Decision**: `usuarios` (pessoa, login) ↔ `organizations` via `memberships(usuario_id, org_id,
  papel)`, papéis `owner|admin|assistente`. **Signup** cria usuário + organização + membership `owner`.
  A sessão guarda a **organização ativa**; usuários em várias orgs trocam a org ativa. O `req.principal`
  passa a carregar `{ tipo, org_id, papel, ... }`.
- **Rationale**: Modelo padrão de SaaS; permite crescer para times sem retrabalho (FR-002). Mantém os
  planos de credencial (sessão para pessoas, Bearer para máquinas) do Princípio III, agora por org.
- **Alternatives considered**: 1 usuário = 1 org fixo (rígido demais; retrabalho ao adicionar times);
  papel global em vez de por org (não isola permissões por tenant).

## D5 — MCP e chaves escopados por organização (estende a 001)

- **Decision**: `api_keys` ganha `org_id`. `verificarApiKey` resolve a org da chave; `requireBearer`
  popula `req.principal.org_id`; o handler MCP roda as ferramentas **dentro de `withOrg(org_id, …)`**.
  Assim cada agente opera só os dados da sua org, com a mesma paridade/auditoria da 001.
- **Rationale**: Cumpre "cada cliente tem o seu próprio agente conectado" (FR-014/015) reutilizando a
  feature 001; o isolamento vem de RLS, não de filtros espalhados.
- **Alternatives considered**: um endpoint MCP por org (mais infra, sem ganho); escopos finos por chave
  na v1 (adiado — Assumption herdada da 001; toda chave da org acessa o conjunto da org).
- **Nota de auditoria**: escrita via MCP grava `created_by='ia'` + `org_id` derivados da credencial,
  nunca da entrada (FR-008, Princípio IV).

## D6 — Cobrança: pagar.me Assinaturas + webhooks (sem cartão no servidor)

- **Decision**: Usar a API de **Assinaturas/Planos** do pagar.me. Fluxo: criar **Customer** →
  assinar um **Plano** (Básico/Intermediário/VIP, ciclo mensal). O cartão é capturado por
  **tokenização no cliente** (`pagar.me.js`) ou por **checkout hospedado/Payment Link** — **nenhum PAN
  trafega/é armazenado no nosso servidor** (Princípio II, FR-007). O estado vem de **webhooks** dos
  eventos de assinatura/fatura, com **assinatura verificada** e **idempotência** por id de evento.
- **Rationale**: Recorrência nativa (não reimplementar billing); escopo PCI mínimo; permissões
  derivadas só do estado verificado (Princípio VI).
- **Alternatives considered**: cobrar transações avulsas e controlar recorrência na mão (reimplementa o
  motor de assinatura, retentativas, dunning — frágil); guardar cartão (amplia muito o escopo PCI —
  rejeitado).
- **Estados** (mapeados para entitlements): `active`/`trialing` → acesso pleno do plano;
  `past_due` → **carência**; `unpaid`/`canceled` → **suspenso**. Detalhe em
  [contracts/billing-pagarme.md](contracts/billing-pagarme.md).
- **Webhook robusto**: responder rápido (2xx) e enfileirar o processamento; tabela `billing_events`
  (id externo único) garante idempotência; **reconciliação** periódica (job) cobre webhook perdido.

## D7 — Catálogo de planos como fonte de verdade local

- **Decision**: Uma tabela/módulo `plans` local (codigo, nome, preco_centavos, `limite_clientes`,
  `features` JSON) espelha os planos do pagar.me. Entitlements = `plan.features` + `subscription.status`.
- **Rationale**: O servidor precisa decidir gating sem ida ao pagar.me a cada request; a fonte de verdade
  do *que cada plano permite* é local, e o *se está pago* vem do pagar.me.
- **Mapa de features** (da figura):
  | Feature | Básico | Intermediário | VIP |
  |---|:--:|:--:|:--:|
  | `limite_clientes` | 5.000 | 50.000 (config.) | ∞ |
  | `gordon_chat` | ✓ | ✓ | ✓ |
  | `relatorios_basicos` | ✓ | ✓ | ✓ |
  | `relatorios_avancados` | — | ✓ | ✓ |
  | `automacoes_funil` | — | ✓ | ✓ |
  | `whatsapp_ia` (resumo·sentimento·resposta) | — | — | ✓ |
  | `ia_avancada_conversas` | — | — | ✓ |

## D8 — WhatsApp: abstração de provider (Evolution/Z-API)

- **Decision**: Interface única `WhatsAppProvider` em `whatsapp/provider.js`, com adapters `evolution.js`
  e `zapi.js`. Métodos: `createInstance(org)`, `getConnectionState(org)`, `getQrCodeOrPairing(org)`,
  `sendMessage(org, to, content)`, `logout(org)`, e `parseInbound(rawPayload) → NormalizedMessage`. O
  provider ativo é escolhido por `WHATSAPP_PROVIDER`.
- **Rationale**: O usuário quer poder usar Evolution **ou** Z-API; abstrair evita lock-in de uma API
  **não oficial** (sujeita a mudança/ban) e mantém a lógica de ingestão única.
- **Inbound**: cada provider posta em `POST /webhooks/whatsapp/:provider`; o handler **identifica a org
  pela instância**, **verifica o segredo**, **normaliza**, grava `whatsapp_messages` (idempotente por id
  externo da mensagem), associa/cria o `cliente` pelo telefone e **enfileira** os jobs de IA.
- **Conexão**: uma instância por org (`whatsapp_connections`, única por `org_id`); estado conectando→
  conectado→desconectado; QR/pairing exibido na UI; só VIP (gating).
- **Alternatives considered**: WhatsApp Cloud API oficial — rejeitado para este escopo (o usuário pediu
  API não oficial para conectar a linha pessoal/comercial existente via QR); um único provider fixo —
  rejeitado (lock-in). Detalhe em [contracts/whatsapp-provider.md](contracts/whatsapp-provider.md).

## D9 — IA Claude: roteamento por tarefa + governança de custo

- **Decision**: Módulo `ai/router.js` escolhe o **modelo por tarefa**:
  | Tarefa | Modelo (config) | Por quê |
  |---|---|---|
  | Sentimento, triagem/intenção, extração de campos do lead | **Haiku** (`claude-haiku-4-5`) | alto volume, baixa complexidade, mais barato/rápido |
  | Resumo de conversa, Gordon (chat), redação de resposta/proposta, narrativa de relatório | **Sonnet** (`claude-sonnet-4-6`) | equilíbrio qualidade/custo no caso geral |
  | Raciocínio complexo / auto-atendimento escalado / análise multi-passo | **Opus** (`claude-opus-4-8`) | reservado ao que exige a maior capacidade |
  Os **IDs ficam em configuração** (trocáveis sem mexer na lógica).
- **Controles de custo** (Princípio VII):
  - **Cache de prompt** (`cache_control`) para instruções de sistema/contexto longo e estável →
    reduz fortemente o custo de input nas chamadas repetidas (Gordon, prompts de tarefa).
  - **Processamento em lote** (Batch API) para jobs **não interativos** em massa (ex.: re-resumo
    noturno, sentimento em lote) → desconto sobre o uso síncrono.
  - **Orçamento por organização**: tabela `ai_usage` registra (org, tarefa, modelo, tokens, custo); um
    teto por plano/período; ao se aproximar, **degradar** (Opus→Sonnet→Haiku) ou **enfileirar/bloquear**
    com aviso, nunca estourar.
  - **Janela mínima**: enviar só o necessário (resumir-e-armazenar para não reenviar histórico inteiro);
    `max_tokens` por tarefa; truncar contexto.
  - **Escalonamento**: começar barato (Haiku) e subir (Sonnet/Opus) só sob baixa confiança/complexidade.
- **Rationale**: a margem do SaaS depende do custo de inferência; rotear por tarefa + medir por tenant é
  o que mantém o produto lucrável (Princípio VII, FR-023/024/025). Detalhe em
  [contracts/ai-routing.md](contracts/ai-routing.md).
- **Confirmar preços vigentes** dos modelos na implementação (a referência de skill `claude-api` traz os
  valores atuais por modelo e o suporte a cache/lote); o roteador trabalha com custo **relativo** e a
  config carrega os preços para o cálculo de `ai_usage`.

## D10 — "Gordon": assistente de chat que opera o CRM por org

- **Decision**: Gordon é um agente de chat (presente desde o Básico) que conversa com o usuário e
  **usa as ferramentas do CRM da org** (a mesma camada `crm-service.js`/MCP) para ler e escrever, sob as
  permissões do plano e dentro de `withOrg`. Modelo padrão **Sonnet** (config), com cache de prompt.
- **Rationale**: aproveita a interface dupla (Princípio III) e a 001 (ferramentas já definidas);
  escritas do Gordon ficam auditadas como `ia` + `org_id`.
- **Alternatives considered**: chat "burro" (só FAQ) — entrega menos valor; agente sem as ferramentas do
  CRM — duplicaria lógica.

## D11 — Assíncrono: `pg-boss` (fila em Postgres) + worker dedicado

- **Decision**: `pg-boss` para filas (ingestão de WhatsApp, jobs de IA, processamento de webhook,
  reconciliação de cobrança, rollup de uso). Um **worker** (`jobs/worker.js`) roda como processo
  dedicado (mesmo código). Webhooks **aceitam e enfileiram** (resposta rápida); o trabalho pesado roda
  no worker com retry/idempotência.
- **Rationale**: trabalho assíncrono real sem adicionar Redis (Princípio I) — usa o Postgres que já
  existe; isola picos de IA/ingestão do caminho interativo.
- **Alternatives considered**: processar inline no webhook (lento, perde eventos, acopla); Redis/BullMQ
  (mais robusto em alta escala, mas adiciona datastore — adiado, Complexity Tracking); cron (sem
  retry/visibilidade).

## D12 — Operador do SaaS: acesso cross-tenant explícito e auditado

- **Decision**: Um papel de **operador** (a empresa dona da plataforma), separado dos usuários de org.
  O painel do operador usa consultas **explicitamente cross-tenant** (helper dedicado, fora do `withOrg`
  de tenant, restrito a esse papel) e **audita** toda ação. Mantido fora do caminho normal para não
  enfraquecer o RLS.
- **Rationale**: operar o negócio (suporte, suspensão, métricas) exige visão cross-tenant, que é a
  exceção controlada do Princípio V (FR-026).
- **Alternatives considered**: dar `BYPASSRLS` à aplicação — rejeitado (enfraquece o isolamento de todos
  os caminhos); um banco/admin separado — overkill para a v1.

## D13 — Migração da base atual e frontend

- **Decision**: `scripts/migrate-sqlite-to-pg.js` lê o `crm.db` atual e insere os dados em uma
  **organização inicial** (a do dono atual), preservando `created_by`/datas. O frontend continua
  **vanilla** (Princípio I): novas telas (signup, plano/checkout, conectar WhatsApp com QR, Gordon,
  relatórios) são adicionadas em `public/` sem framework/build.
- **Rationale**: continuidade dos dados existentes; manter a stack de front enquanto atender ao escopo.
- **Alternatives considered**: recomeçar do zero (perde dados/contexto); migrar o front para um
  framework agora (custo sem necessidade comprovada — adiável com registro).

## Decisões confirmadas (2026-06-07)

- **Trial**: **14 dias** de teste gratuito antes da 1ª cobrança — `status='trialing'` com **acesso pleno
  do plano escolhido**, sem cobrança; `trial_end = signup + 14 dias`. Ao fim, com cartão → cobra e vira
  `active`; sem cartão/falha → suspenso. Ver D6 e [contracts/billing-pagarme.md](contracts/billing-pagarme.md).
- **Meio de pagamento**: **somente cartão de crédito** (recorrência); sem Pix/boleto na v1.
- **Teto de clientes do Intermediário**: teto superior **configurável**, **default 50.000** (Básico
  5.000, VIP ilimitado).
- **Retenção (LGPD)**: orgs `canceled`/`unpaid` mantêm os dados por **90 dias** antes da purga; export
  continua disponível na janela; reativação dentro do prazo restaura o acesso.
- **Provider de WhatsApp inicial**: **Evolution API** (auto-hospedada no Docker/Traefik); a Z-API
  permanece como adapter alternativo (troca por `WHATSAPP_PROVIDER`).

## Resumo das decisões

Banco Postgres **compartilhado com RLS** (`org_id` UUID, `SET LOCAL app.current_org`), `pg` +
`node-pg-migrate`, contas com `memberships`/org ativa, **MCP e chaves escopados por org**, cobrança
**pagar.me Assinaturas** com webhooks **assinados+idempotentes** e permissões derivadas só do estado
verificado, catálogo de planos local para gating, **WhatsApp atrás de abstração** (Evolution/Z-API) com
ingestão idempotente, **IA Claude roteada por tarefa** (Haiku/Sonnet/Opus) com cache/lote e **teto por
org**, **Gordon** operando o CRM da org, **`pg-boss`** + worker para o assíncrono, e **operador**
cross-tenant explícito/auditado. Frontend permanece vanilla; base atual migrada para a org inicial.
