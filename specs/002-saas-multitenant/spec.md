# Feature Specification: SaaS Multi-Tenant — Planos, Cobrança (pagar.me), WhatsApp e IA Claude

**Feature Branch**: `002-saas-multitenant`

**Created**: 2026-06-07

**Status**: Draft

**Input**: User description: "Quero transformar a aplicação em SaaS, onde cada cliente tem seu próprio
agente conectado; colocar checkout de pagamento via pagar.me (planos Básico/Intermediário/VIP); no
plano VIP o cliente conecta seu WhatsApp por uma API não oficial (Evolution ou Z-API), uma linha por
cliente, para resumir e integrar conversas de leads, fazer análise de sentimento e, eventualmente, um
robô de auto-atendimento com IA. Usar o Claude como API de IA, otimizando custo entre Haiku, Sonnet e
Opus conforme a tarefa."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conta própria e isolamento entre clientes (Priority: P1)

Uma pessoa cria uma **conta (organização)** no produto, faz login e passa a usar o CRM (Hoje, Funil,
Clientes, interações) vendo **apenas os dados da sua organização**. Nada do que ela cadastra é visível
para qualquer outra organização, e ela nunca enxerga dados de terceiros — nem pela interface, nem pela
API/MCP, nem por adivinhação de identificadores.

**Why this priority**: É a fundação do SaaS. Sem multi-tenancy com isolamento confiável, nenhuma das
demais funcionalidades (cobrança, WhatsApp, IA por cliente) pode existir com segurança. Entregue
sozinho, já transforma o CRM de dono único em uma base multi-cliente utilizável.

**Independent Test**: Criar duas organizações distintas; em cada uma cadastrar clientes/interações;
confirmar que cada conta lista/abre/edita somente os seus dados e que tentativas de acessar um registro
da outra org (por ID direto na API/MCP) retornam "não encontrado", sem vazar dados.

**Acceptance Scenarios**:

1. **Given** uma pessoa sem conta, **When** ela se cadastra com nome, e-mail e senha, **Then** uma
   organização é criada, ela vira o `owner` dela e entra autenticada no CRM vazio daquela org.
2. **Given** duas organizações com dados próprios, **When** um usuário de uma delas lista ou abre
   clientes, **Then** vê exclusivamente os dados da sua organização.
3. **Given** um usuário autenticado na org A, **When** ele tenta abrir/editar/excluir um cliente cujo
   ID pertence à org B (via API ou MCP), **Then** o sistema responde "não encontrado" e nenhum dado da
   org B é exposto ou alterado.
4. **Given** um registro criado em qualquer org, **When** ele é gravado, **Then** carrega o `org_id`
   correto e o autor derivado da credencial (humano/IA).

---

### User Story 2 - Assinar um plano e pagar via pagar.me (Priority: P1)

O responsável pela organização escolhe um plano (**Básico R$ 39,90 / Intermediário R$ 69,90 / VIP
R$ 299,90 por mês**), conclui o pagamento por um checkout do pagar.me e passa a ter o acesso do plano
ativo. Se o pagamento falhar ou a assinatura for cancelada, o acesso é ajustado conforme a política de
cobrança; se for atualizado/rebaixado, as permissões mudam de acordo.

**Why this priority**: É o que torna o produto um SaaS de fato (receita recorrente) e o que governa
quais recursos cada organização pode usar. Depende de US1 (precisa existir a organização).

**Independent Test**: Em ambiente de teste do pagar.me, assinar cada plano com cartão de teste;
confirmar (via webhook simulado) que a assinatura fica ativa e o plano correto é refletido; simular
falha de pagamento e cancelamento e confirmar a mudança de estado/permissões.

**Acceptance Scenarios**:

1. **Given** uma organização sem assinatura ativa, **When** o responsável escolhe um plano e conclui o
   checkout do pagar.me, **Then** após a confirmação (webhook) a organização passa a ter aquele plano
   ativo, com período vigente registrado.
2. **Given** uma assinatura ativa, **When** o pagar.me notifica falha de pagamento, **Then** a
   organização entra em **carência** e, esgotada a carência sem regularização, é **suspensa** (acesso
   restrito) — conforme política definida.
3. **Given** uma assinatura ativa, **When** o responsável faz upgrade ou downgrade de plano, **Then**
   os limites e recursos da organização passam a refletir o novo plano de forma previsível.
4. **Given** um webhook do pagar.me, **When** ele chega, **Then** sua **assinatura é verificada** e o
   evento é processado **uma única vez** (idempotente), mesmo se reenviado.
5. **Given** o front informando "sou VIP", **When** o servidor decide o que liberar, **Then** ignora o
   front e usa apenas o estado de assinatura verificado.
6. **Given** uma organização recém-criada, **When** ela começa a usar, **Then** ganha um **trial de 14
   dias** com acesso pleno ao plano escolhido; ao fim do trial, com cartão válido ocorre a 1ª cobrança
   (→ ativa) e, sem cartão/falha, a organização é suspensa.

---

### User Story 3 - Limites e recursos por plano (feature gating) (Priority: P2)

Cada plano libera um conjunto de recursos e um limite de clientes (leads) no CRM. O sistema impede o uso
de recursos fora do plano e respeita o limite de clientes, sempre no servidor.

**Why this priority**: Diferencia os planos e protege a margem; depende de US2 (estado de assinatura) e
US1 (organização).

**Independent Test**: Com cada plano ativo, tentar usar um recurso superior ao plano (ex.: WhatsApp com
IA no Básico) e exceder o limite de clientes; confirmar bloqueio claro e convite a upgrade.

**Acceptance Scenarios**:

1. **Given** uma organização no plano **Básico**, **When** ela tenta acessar **WhatsApp com IA** ou
   relatórios/automações avançados, **Then** o recurso é bloqueado com mensagem de upgrade.
2. **Given** uma organização que atingiu o **limite de clientes** do plano, **When** tenta criar mais um
   cliente, **Then** a criação é bloqueada com mensagem clara (e o limite vale também via API/MCP).
3. **Given** uma organização **VIP**, **When** ela usa relatórios avançados, automações de funil e
   WhatsApp com IA, **Then** todos ficam disponíveis.
4. **Given** um recurso liberado por plano, **When** o plano é rebaixado abaixo do necessário, **Then**
   o recurso deixa de ser utilizável a partir da mudança de estado.

---

### User Story 4 - Cada cliente com seu próprio agente (chaves/MCP por organização) + Gordon (Priority: P2)

Cada organização emite as suas próprias chaves de API e conecta o seu próprio agente de IA, que opera
**somente os dados daquela organização** via API REST e via servidor MCP. Em todos os planos, a
organização conta com o assistente de chat **"Gordon"**, que conversa e opera o CRM da org (com as
permissões do plano).

**Why this priority**: É um pedido explícito ("cada cliente pode ter o seu próprio agente conectado") e
o "Gordon no chat" aparece já no plano Básico. Estende a feature 001 (MCP) para multi-tenant. Depende de
US1 (isolamento) e se beneficia de US3 (gating).

**Independent Test**: Em duas organizações, emitir chaves próprias; usar a chave da org A no MCP e
confirmar que só os dados da org A aparecem; usar o Gordon em cada org e confirmar que ele só enxerga e
altera os dados da org corrente.

**Acceptance Scenarios**:

1. **Given** um responsável autenticado na sua org, **When** ele cria uma chave de API, **Then** a
   chave é **escopada à organização** e só dá acesso aos dados dela (REST e MCP).
2. **Given** a chave da org A, **When** um agente a usa no `/mcp`, **Then** todas as operações enxergam
   e alteram apenas dados da org A; a credencial revogada perde acesso em segundos.
3. **Given** o assistente **Gordon** em uma org, **When** o usuário pede para listar follow-ups de hoje
   ou criar um lead, **Then** o Gordon executa a ação no CRM **daquela** org e marca escritas como IA.
4. **Given** uma escrita feita por chave/MCP/Gordon, **When** ela é gravada, **Then** fica auditada como
   `ia` e com o `org_id` correto, não falsificável por entrada do cliente.

---

### User Story 5 - Conectar o WhatsApp da organização (uma linha) — plano VIP (Priority: P3)

No plano **VIP**, o responsável conecta **uma** linha de WhatsApp da organização por meio de um provedor
não oficial (Evolution API ou Z-API, abstraídos), tipicamente lendo um QR Code / código de pareamento.
Conectada a linha, as mensagens de leads que chegam pelo WhatsApp passam a ser registradas no CRM da
organização.

**Why this priority**: É o recurso headline do VIP e a porta de entrada para a IA sobre conversas;
depende de US1/US2/US3 (org, assinatura VIP, gating) estarem prontos.

**Independent Test**: Com uma org VIP, iniciar a conexão, parear a linha (sandbox do provedor),
confirmar status "conectado"; enviar uma mensagem de um número externo e confirmar que ela vira um lead
+ mensagem registrada na org; confirmar que uma org não-VIP não consegue conectar.

**Acceptance Scenarios**:

1. **Given** uma org **VIP** sem WhatsApp conectado, **When** o responsável inicia a conexão, **Then** o
   sistema apresenta o QR/código de pareamento do provedor e passa a refletir o estado (conectando →
   conectado).
2. **Given** uma org **não-VIP**, **When** ela tenta conectar o WhatsApp, **Then** a ação é bloqueada
   com mensagem de upgrade.
3. **Given** uma linha conectada, **When** um lead envia uma mensagem para ela, **Then** a mensagem é
   recebida pelo webhook do provedor, atribuída à **organização correta** e registrada (criando o lead
   se for um número novo) — processada **uma única vez** (idempotente).
4. **Given** uma organização já com uma linha conectada, **When** tenta conectar uma segunda linha,
   **Then** o sistema impede (uma linha por organização) ou substitui de forma explícita.
5. **Given** uma linha conectada, **When** o responsável a desconecta, **Then** a sessão é encerrada no
   provedor e o estado é atualizado e auditado.

---

### User Story 6 - IA sobre as conversas: resumo, sentimento e auto-atendimento (Priority: P3)

No plano **VIP**, sobre as conversas de WhatsApp, a organização obtém: **resumo** automático das
conversas integradas ao histórico do lead, **análise de sentimento** e, opcionalmente, um **robô de
auto-atendimento com IA**. Tudo usando o Claude, com o **modelo escolhido conforme a tarefa** para
otimizar custo, e com **consumo medido e limitado** por organização.

**Why this priority**: É o valor de IA do topo de gama; depende de US5 (conversas chegando) e da
governança de custo. Pode ser entregue em fatias (primeiro resumo+sentimento; auto-atendimento depois).

**Independent Test**: Com conversas registradas em uma org VIP, disparar resumo e sentimento e
confirmar que aparecem no histórico do lead; ativar o auto-atendimento e confirmar uma resposta gerada;
verificar que tarefas simples usam o modelo mais barato e que o consumo é contabilizado e respeita o
teto da org.

**Acceptance Scenarios**:

1. **Given** uma conversa de WhatsApp com várias mensagens, **When** o resumo é gerado, **Then** um
   resumo conciso é anexado ao histórico do lead, marcado como gerado por IA.
2. **Given** uma mensagem/conversa de lead, **When** a análise de sentimento roda, **Then** um rótulo de
   sentimento (ex.: positivo/neutro/negativo) é associado ao lead/conversa.
3. **Given** o auto-atendimento ativado, **When** um lead envia uma mensagem, **Then** o sistema pode
   responder automaticamente via WhatsApp (com a resposta registrada e marcada como IA), respeitando
   regras de ativação/handoff para humano.
4. **Given** uma tarefa de baixa complexidade (sentimento/triagem) e uma de alta (raciocínio
   complexo), **When** a IA é chamada, **Then** o sistema usa um modelo **mais barato** para a simples e
   um **mais capaz** para a complexa, conforme configuração por tarefa.
5. **Given** uma organização que atingiu seu **teto de consumo de IA** no período, **When** novas
   chamadas seriam feitas, **Then** o sistema degrada (modelo menor/enfileira) ou bloqueia com aviso, sem
   estourar custo.

---

### User Story 7 - Painel do operador do SaaS (Priority: P3)

O operador do SaaS (a empresa dona da plataforma) acompanha as organizações, suas assinaturas, o estado
de conexão de WhatsApp e o consumo de IA, e consegue agir (ex.: suspender, ajustar plano) — com acesso
**explícito e auditado**, separado do acesso das organizações.

**Why this priority**: Necessário para operar o negócio, mas não bloqueia o uso pelos clientes; pode vir
após o núcleo. As consultas cross-tenant aqui são a exceção controlada ao isolamento (Princípio V).

**Independent Test**: Como operador, listar organizações e ver assinatura/uso de cada uma; confirmar que
um usuário comum de organização **não** acessa esse painel; confirmar que toda ação do operador é
registrada.

**Acceptance Scenarios**:

1. **Given** um operador autenticado, **When** ele abre o painel, **Then** vê a lista de organizações
   com plano, estado de assinatura, WhatsApp e consumo de IA do período.
2. **Given** um usuário comum de organização, **When** tenta acessar o painel do operador, **Then** o
   acesso é negado.
3. **Given** uma ação administrativa do operador (ex.: suspender uma org), **When** executada, **Then**
   ela é aplicada e **auditada** (quem, o quê, quando).

---

### Edge Cases

- **Vazamento entre tenants**: qualquer consulta sem contexto de organização DEVE retornar vazio/negar,
  nunca dados de outra org (teste negativo de RLS é obrigatório).
- **Webhook duplicado/atrasado/fora de ordem** (pagar.me ou WhatsApp): processado de forma idempotente;
  reprocessar não duplica cobrança nem mensagem; eventos fora de ordem convergem para o estado correto.
- **Webhook não assinado/assinatura inválida**: rejeitado sem efeito.
- **Falha/instabilidade do provedor de WhatsApp** (desconexão, ban, QR expirado): estado reflete
  "desconectado"; mensagens não se perdem silenciosamente; reconexão é possível.
- **Número de WhatsApp já associado a outro lead/conversa**: a mensagem é anexada ao lead existente, sem
  duplicar.
- **Limite de clientes atingido exatamente na fronteira**: o N-ésimo é permitido, o N+1 é bloqueado, de
  forma consistente na UI, API e MCP.
- **Downgrade com uso acima do novo limite** (ex.: VIP→Básico com >5.000 clientes ou WhatsApp conectado):
  política explícita — bloquear novas criações/recursos e orientar, sem apagar dados existentes.
- **Estouro de orçamento de IA no meio de uma operação**: degradar/enfileirar de forma graciosa.
- **Cancelamento/inadimplência**: dados preservados durante a **retenção de 90 dias**; acesso restrito;
  export LGPD continua possível na janela; reativação no prazo restaura o acesso.
- **Pagamento aprovado mas webhook não chega**: reconciliação periódica corrige o estado.

## Requirements *(mandatory)*

### Functional Requirements

**Multi-tenancy e contas**
- **FR-001**: O sistema MUST permitir o **auto-cadastro** de uma pessoa, criando uma **organização** e
  tornando-a `owner`, e MUST autenticá-la em seguida.
- **FR-002**: O sistema MUST modelar **organização**, **usuário** e **vínculo (membership)** com papéis
  (ex.: `owner`/`admin`/`assistente`), permitindo que uma organização tenha mais de um usuário.
- **FR-003**: Toda entidade de domínio (clientes, interações, chaves, conexões de WhatsApp, mensagens,
  uso de IA, assinaturas) MUST pertencer a uma organização (`org_id`).
- **FR-004**: O sistema MUST **isolar** os dados por organização de forma que nenhuma organização
  acesse dados de outra por nenhuma interface (UI, API, MCP), inclusive por tentativa de acesso direto a
  identificadores; o isolamento MUST ser imposto também no armazenamento (não apenas na aplicação).
- **FR-005**: Toda requisição autenticada MUST resolver a **organização ativa** do solicitante; sem
  organização no contexto, operações de dados de tenant MUST falhar/retornar vazio.

**Cobrança (pagar.me)**
- **FR-006**: O sistema MUST oferecer os planos **Básico (R$ 39,90/mês)**, **Intermediário
  (R$ 69,90/mês)** e **VIP (R$ 299,90/mês)** e permitir que a organização assine um deles via checkout
  do **pagar.me**.
- **FR-007**: O sistema MUST NOT transitar nem armazenar dados completos de cartão no próprio servidor
  (tokenização no cliente ou checkout hospedado).
- **FR-008**: O sistema MUST receber e processar **webhooks do pagar.me** com **assinatura verificada**
  e de forma **idempotente**, mantendo o estado de assinatura da organização (ativa, em carência,
  suspensa, cancelada) e o período vigente.
- **FR-009**: O sistema MUST derivar as permissões da organização **apenas** do estado de assinatura
  verificado no servidor — nunca de informação enviada pelo cliente.
- **FR-010**: O sistema MUST suportar **upgrade/downgrade** e **cancelamento** de plano, refletindo as
  permissões de forma previsível, e MUST aplicar uma **política de inadimplência** (carência →
  suspensão) explícita.
- **FR-011**: O sistema MUST **reconciliar** periodicamente o estado de assinatura com o pagar.me para
  corrigir divergências (ex.: webhook perdido).

**Planos: limites e recursos**
- **FR-012**: O sistema MUST impor, **no servidor** e em todas as interfaces, o **limite de clientes**
  de cada plano (Básico: até 5.000; Intermediário: teto superior configurável; VIP: ilimitado).
- **FR-013**: O sistema MUST impor o **gating de recursos** por plano: relatórios básicos e o assistente
  **Gordon** em todos; relatórios avançados e automações de funil no Intermediário e VIP; **WhatsApp com
  IA** e IA avançada nas conversas **somente no VIP**.

**Agente por organização (API/MCP) + Gordon**
- **FR-014**: O sistema MUST permitir que cada organização **emita e revogue** suas próprias chaves de
  API/MCP, **escopadas à organização**; uma chave NUNCA dá acesso a outra organização.
- **FR-015**: O servidor **MCP** MUST operar **no contexto da organização** da credencial, com paridade
  de operações já existente, mantendo a auditoria derivada da credencial.
- **FR-016**: O sistema MUST oferecer o assistente de chat **Gordon** que conversa com o usuário e opera
  o CRM **da organização corrente**, respeitando os limites/recursos do plano e marcando escritas como
  IA.

**WhatsApp (VIP)**
- **FR-017**: O sistema MUST permitir que uma organização **VIP** conecte **uma** linha de WhatsApp por
  meio de um provedor não oficial, **abstraído atrás de uma interface única** com adapters para
  Evolution API e Z-API (provider selecionável por configuração), tipicamente via QR/pareamento, e MUST
  refletir o estado da conexão.
- **FR-018**: O sistema MUST **receber mensagens** de leads via webhook do provedor, **atribuí-las à
  organização correta**, registrá-las no CRM (criando o lead a partir do número quando novo) e
  processá-las de forma **idempotente**.
- **FR-019**: O sistema MUST permitir **desconectar** a linha e MUST impedir mais de uma linha ativa por
  organização; conexão/desconexão MUST ser auditada.
- **FR-020**: O sistema SHOULD permitir **enviar** mensagens pela linha conectada (necessário para o
  auto-atendimento), registrando a saída e marcando-a como IA quando gerada por IA.

**IA (Claude) sobre conversas + governança de custo**
- **FR-021**: O sistema MUST gerar **resumo** de conversas de WhatsApp e anexá-lo ao histórico do lead,
  e MUST produzir **análise de sentimento** associada ao lead/conversa (VIP).
- **FR-022**: O sistema SHOULD oferecer **auto-atendimento com IA** (resposta automática a leads via
  WhatsApp) com regras de ativação e **handoff** para humano (VIP).
- **FR-023**: O sistema MUST **selecionar o modelo Claude conforme a tarefa** (tarefas simples →
  modelo mais barato; complexas → modelo mais capaz), com os identificadores de modelo em
  **configuração**.
- **FR-024**: O sistema MUST **medir** o consumo de IA por organização e MUST **limitar/degradar** o uso
  ao atingir o orçamento do plano, sem permitir gasto ilimitado por requisição ou por organização.
- **FR-025**: O sistema MUST enviar à IA **apenas o necessário** e usar sub-processador que **não treina**
  com os dados; toda saída de IA gravada MUST ser marcada como gerada por IA.

**Operação, segurança e LGPD**
- **FR-026**: O sistema MUST oferecer um **painel do operador** do SaaS, com acesso separado e auditado,
  para acompanhar organizações, assinaturas, WhatsApp e consumo de IA, e executar ações administrativas;
  qualquer consulta **cross-tenant** MUST ser explícita, restrita e auditada.
- **FR-027**: O sistema MUST manter os direitos do titular **por organização** (exportar e excluir os
  dados de um cliente) e MUST permitir que uma organização exporte/exclua os seus próprios dados.
- **FR-028**: O sistema MUST **auditar** eventos sensíveis (mudança de plano, conexão/desconexão de
  WhatsApp, exclusão LGPD, ações do operador) com organização, autor e horário.
- **FR-029**: O sistema MUST aplicar `helmet`, **rate limiting** e validação de payload em todas as
  superfícies (UI, API, MCP, webhooks), e MUST verificar segredos de webhook em tempo constante.
- **FR-030**: A migração da base atual (CRM de dono único) MUST preservar os dados existentes,
  alocando-os a uma **organização inicial** sem perda nem mistura com novas organizações.

### Key Entities *(include if feature involves data)*

- **Organização (tenant)**: a conta pagante. Atributos: nome, estado (ativa/suspensa/cancelada),
  organização criada por/quando. Raiz de todo isolamento.
- **Usuário**: pessoa que faz login. Pode pertencer a uma ou mais organizações.
- **Vínculo (Membership)**: liga usuário ↔ organização com um papel (owner/admin/assistente).
- **Plano**: Básico/Intermediário/VIP — preço, limite de clientes, conjunto de recursos (features).
- **Assinatura**: vínculo organização ↔ plano no pagar.me — estado (ativa/carência/suspensa/cancelada),
  período vigente, referência externa.
- **Evento de Cobrança**: registro idempotente de webhook/transação do pagar.me (tipo, referência,
  processado em).
- **Chave de API (por organização)**: credencial de máquina escopada à org (rótulo, prefixo, hash,
  ativa, último uso) — base do "agente próprio" e do MCP.
- **Cliente/Lead**: entidade existente do CRM, agora pertencente a uma organização.
- **Interação**: anotação/evento no histórico do lead, com origem (humano/IA) e tipo (nota, resumo de
  IA, sentimento), pertencente a uma organização.
- **Conexão de WhatsApp**: a linha conectada de uma organização (provedor, identificador de instância,
  estado, conectada em). Uma por organização.
- **Mensagem de WhatsApp**: mensagem recebida/enviada (lead, direção, conteúdo, id externo para
  idempotência), pertencente a uma organização e a um lead/conversa.
- **Uso de IA**: medição por chamada (organização, tarefa, modelo, tokens entrada/saída, custo,
  quando) — base do orçamento por organização.
- **Registro de Auditoria**: quem (usuário/credencial/operador), organização, o quê e quando, para
  eventos sensíveis.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **Zero** vazamento entre organizações: 100% das tentativas de acessar dados de outra org
  (UI, API, MCP) retornam "não encontrado"/negado, sem expor dados — comprovado por teste negativo.
- **SC-002**: Uma pessoa nova consegue **criar conta, assinar um plano e começar a usar** o CRM em menos
  de 10 minutos.
- **SC-003**: Após a confirmação de pagamento (webhook), o plano da organização passa a refletir o
  estado correto em **segundos**; webhooks reenviados não causam efeito duplicado (idempotência 100%).
- **SC-004**: 100% das tentativas de usar um recurso fora do plano ou de exceder o limite de clientes
  são **bloqueadas no servidor** (inclusive via API/MCP), com mensagem clara.
- **SC-005**: Cada organização opera **apenas os seus dados** via chave/MCP/Gordon; 100% das escritas de
  IA ficam atribuídas a `ia` com o `org_id` correto, não falsificável.
- **SC-006**: Uma organização VIP conecta uma linha de WhatsApp e recebe a primeira mensagem de lead
  registrada na sua org em poucos minutos; mensagens duplicadas do provedor não geram registros
  duplicados.
- **SC-007**: Resumo e sentimento aparecem no histórico do lead para conversas VIP; o **roteamento por
  tarefa** reduz o custo de IA de forma mensurável frente a usar sempre o modelo mais capaz, e nenhuma
  organização ultrapassa o seu teto de consumo do período.
- **SC-008**: 100% dos webhooks com assinatura inválida são rejeitados sem efeito; dados de cartão
  nunca tocam o servidor.
- **SC-009**: O operador identifica, para qualquer organização, o plano, o estado de assinatura, o
  estado de WhatsApp e o consumo de IA do período; toda ação administrativa fica auditada.

## Assumptions

- Há uma conta **pagar.me** com chaves de API e segredo de webhook disponíveis; a cobrança é **somente
  por cartão de crédito** (sem Pix/boleto na v1), com **trial de 14 dias** antes da 1ª cobrança. Os
  preços são os da figura (39,90 / 69,90 / 299,90) e podem ser ajustados em configuração.
- O limite "Básico: até 5.000 clientes" é um teto por organização; "Intermediário: a partir de 5.000"
  é modelado como um teto superior configurável (**default 50.000**) e "VIP: ilimitado" como sem teto
  prático.
- Há uma chave **Anthropic** disponível; o provedor de IA **não treina** com dados de API. Os modelos
  usados são Claude **Haiku/Sonnet/Opus**, com os IDs vigentes em configuração.
- O provedor de **WhatsApp** inicial é a **Evolution API** (auto-hospedada), atrás de uma abstração que
  mantém a **Z-API** como adapter alternativo (troca por configuração); é uma API **não oficial** (risco
  de bloqueio assumido pelo cliente/operador).
- O isolamento e a concorrência (webhooks, jobs de IA) justificam **PostgreSQL com RLS** e uma fila em
  Postgres (decisões registradas no plano).
- A base atual de dono único é migrada para uma **organização inicial**.
- Mercado brasileiro, LGPD aplicável; mensagens e rótulos em **português**.
- "Gordon" é o assistente de chat de IA do produto (presente desde o Básico), operando o CRM da
  organização via as ferramentas já expostas (REST/MCP).

## Dependencies

- Estende a **feature 001 (servidor MCP autenticado)**, agora **escopada por organização**.
- Depende de **pagar.me** (assinaturas + webhooks), **Anthropic Claude** (IA), e de um **provedor de
  WhatsApp não oficial** (Evolution/Z-API) atrás de abstração.
- Depende de **PostgreSQL** (com RLS) e de uma **fila** baseada em Postgres para trabalho assíncrono.
- Reaproveita a auth e a auditoria existentes (sessão + CSRF para pessoas; Bearer para máquinas;
  autoria derivada da credencial), agora com `org_id`.
