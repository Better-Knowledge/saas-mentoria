# Feature Specification: Servidor MCP Autenticado para Acesso de Agentes

**Feature Branch**: `001-mcp-server-auth`

**Created**: 2026-06-06

**Status**: Draft

**Input**: User description: "quero dar capacidades de servidor MCP para que o CRM possa ser acessado remotamente por agentes. O MCP deve ser autenticado"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agente de IA opera o CRM remotamente via MCP autenticado (Priority: P1)

Um agente de IA executando em outro ambiente (assistente, automação, fluxo de trabalho) se
conecta ao CRM por meio de um servidor MCP usando uma credencial. Uma vez autenticado, ele
descobre o catálogo de operações que pode realizar e passa a ler o funil e registrar leads e
anotações — sem um humano no meio e sem usar a interface web. Tentativas sem credencial válida
são recusadas e nenhum dado do CRM é devolvido.

**Why this priority**: É o coração da funcionalidade — acesso remoto e autenticado de agentes ao
CRM. Sem isso, nada do resto existe. Entregue sozinho, já gera valor: a IA passa a operar o CRM
à distância de forma segura.

**Independent Test**: Conectar um cliente MCP com uma credencial válida, listar as operações
disponíveis, obter as ações de hoje e a lista de clientes, e criar um lead — verificando sucesso.
Repetir sem credencial e com credencial inválida/revogada — verificando que o acesso é negado e
nenhum dado é exposto.

**Acceptance Scenarios**:

1. **Given** uma credencial de agente válida, **When** o agente se conecta ao servidor MCP,
   **Then** ele descobre o catálogo de operações do CRM que está autorizado a usar.
2. **Given** um agente autenticado e conectado, **When** ele pede a lista de clientes ou as ações
   de hoje (atrasadas/hoje/futuras), **Then** recebe os dados atuais do CRM.
3. **Given** um agente autenticado, **When** ele cria um lead com os dados obrigatórios, **Then** o
   lead aparece no funil do CRM e fica atribuído àquele agente.
4. **Given** nenhuma credencial, ou uma credencial inválida/revogada, **When** o agente tenta
   conectar ou chamar qualquer operação, **Then** o acesso é negado e nenhum dado do CRM é retornado.

---

### User Story 2 - Dono concede e revoga o acesso de agentes (Priority: P2)

O dono do CRM emite uma credencial dedicada para cada integração de IA e pode revogá-la de forma
independente a qualquer momento, cortando imediatamente o acesso remoto daquele agente sem afetar
os demais. A credencial é exibida uma única vez no momento da criação.

**Why this priority**: Controlar quem/o quê acessa dados pessoais remotamente é essencial para a
LGPD e para a confiança no sistema. Depende de US1 existir, por isso vem depois.

**Independent Test**: O dono cria uma credencial; o agente a usa com sucesso; o dono revoga; as
chamadas seguintes daquele agente são negadas, enquanto outras credenciais continuam funcionando.

**Acceptance Scenarios**:

1. **Given** o dono autenticado na interface, **When** ele cria uma nova credencial de acesso para
   um agente, **Then** uma credencial é emitida e mostrada uma única vez.
2. **Given** uma credencial de agente ativa, **When** o dono a revoga, **Then** aquele agente deixa
   de acessar o servidor MCP, enquanto as outras credenciais seguem válidas.
3. **Given** uma credencial revogada, **When** o agente tenta usá-la de novo, **Then** o acesso é negado.

---

### User Story 3 - Auditoria confiável das ações dos agentes (Priority: P3)

Toda criação ou alteração feita por um agente remoto através do MCP é registrada como tendo sido
feita por uma IA — derivado da credencial autenticada e não de uma autodeclaração do cliente — de
modo que o dono sempre consiga distinguir atividade humana de atividade de agente, e saiba qual
credencial agiu e quando.

**Why this priority**: Exigido pela constituição (auditoria derivada da credencial) e pela LGPD,
mas se apoia sobre US1 e US2.

**Independent Test**: O agente cria um lead e adiciona uma interação via MCP; inspecionar os
registros → marcados como gerados por IA, com a credencial de origem e o horário; uma ação humana
feita pela interface permanece marcada como humana.

**Acceptance Scenarios**:

1. **Given** um agente cria ou atualiza um registro via MCP, **When** o registro é gravado,
   **Then** ele é atribuído a "IA", com a credencial de origem e o horário.
2. **Given** a mesma operação acompanhada de uma dica forjada de "sou humano", **When** o registro é
   gravado, **Then** a atribuição reflete a credencial real e não pode ser falsificada.

---

### Edge Cases

- **Credencial revogada no meio da sessão**: chamadas em andamento e subsequentes passam a ser negadas.
- **Operação fora do conjunto permitido**: o agente pede algo que não está no catálogo exposto → rejeitado.
- **Entrada malformada ou grande demais**: rejeitada com erro claro, sem gravação parcial.
- **Cliente inexistente**: resposta de "não encontrado", sem vazar dados de outros registros.
- **Excesso de requisições**: o agente ultrapassa o limite permitido → é limitado (throttling).
- **Transporte inseguro em produção**: o TLS é imposto na **borda** (Traefik redireciona HTTP→HTTPS e
  envia HSTS); o app confia no proxy. Conexões em texto puro são redirecionadas para HTTPS antes de
  alcançar o `/mcp` — a garantia é de **deploy** (task T020), não do código do app.
- **Valores de funil/resultado inválidos**: rejeitados, mantendo o registro em um estado consistente.
- **Exclusão/exportação por agente**: como são irreversíveis/sensíveis (LGPD), a ação é registrada na
  auditoria com a credencial de origem; excluir um cliente inexistente retorna "não encontrado".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST expor as operações centrais do CRM a agentes de IA remotos por meio de
  uma interface de servidor MCP.
- **FR-002**: O servidor MCP MUST exigir uma credencial de autenticação válida em toda conexão e em
  toda operação; acesso anônimo MUST ser recusado — não pode existir modo "aberto/sem credencial".
- **FR-003**: O sistema MUST permitir que o dono emita credenciais dedicadas de agente, uma por
  integração, exibidas uma única vez na criação.
- **FR-004**: O sistema MUST permitir que o dono revogue qualquer credencial de agente de forma
  independente e imediata, sem afetar as demais credenciais.
- **FR-005**: O servidor MCP MUST permitir que um agente autenticado descubra o catálogo de
  operações que está autorizado a realizar.
- **FR-006**: Agentes autenticados MUST conseguir ler a lista de clientes, a ficha completa de um
  cliente com seu histórico de interações, e a visão de follow-ups "atrasados / hoje / futuros".
- **FR-007**: Agentes autenticados MUST conseguir criar um lead/cliente, atualizar os dados de um
  cliente, mover um cliente pelas etapas do funil (e definir resultado ganho/perdido) e registrar
  uma interação no histórico.
- **FR-008**: O sistema MUST atribuir todo registro criado ou alterado por um agente a "IA",
  derivando a autoria da credencial autenticada — nunca de um campo ou dica enviada pelo cliente —
  e registrando qual credencial agiu e quando.
- **FR-009**: O sistema MUST validar toda entrada enviada pelo agente (campos obrigatórios, valores
  permitidos, limite de tamanho) e rejeitar requisições inválidas sem gravação parcial, devolvendo
  um erro claro.
- **FR-010**: O servidor MCP MUST ser alcançável remotamente pela rede e MUST exigir transporte
  criptografado ao servir dados reais (produção).
- **FR-011**: O sistema MUST limitar a taxa de requisições dos agentes para proteger contra abuso e
  força bruta.
- **FR-012**: O sistema MUST registrar o uso de cada credencial (último uso) para apoiar o
  monitoramento e a auditoria do acesso dos agentes.
- **FR-013**: Agentes autenticados MUST ter **paridade total** com o conjunto de operações já
  disponível para credenciais de máquina, **incluindo as operações destrutivas/irreversíveis**:
  **excluir um cliente (apagamento LGPD)** e **exportar todos os dados de um cliente**. Por serem
  sensíveis e irreversíveis, essas operações MUST ser igualmente autenticadas, atribuídas à
  credencial de origem (FR-008), auditadas e sujeitas ao limite de taxa (FR-011); a revogação
  imediata da credencial (FR-004) é o mecanismo de contenção em caso de uso indevido.
- **FR-014**: A autenticação do servidor MCP MUST, na v1, reutilizar o plano de credenciais de
  máquina já existente (uma credencial por integração, revogável, enviada como token Bearer). A
  camada de autenticação MUST ser desenhada por trás de uma abstração que permita acrescentar
  posteriormente o fluxo de autorização padrão do protocolo MCP (do tipo OAuth) **sem quebrar** as
  credenciais Bearer já emitidas (abordagem híbrida com evolução planejada).

### Key Entities *(include if feature involves data)*

- **Credencial de Agente (MCP)**: representa o acesso autenticado de uma integração de IA. Atributos
  de interesse: rótulo/nome da integração, identificador parcial visível, estado (ativa/revogada),
  último uso, quem a criou e quando. O segredo é mostrado uma única vez.
- **Operação Exposta**: uma capacidade do CRM disponibilizada ao agente, com paridade total ao que as
  credenciais de máquina já podem fazer (ex.: listar clientes, obter ficha do cliente, criar lead,
  atualizar cliente, mover etapa, registrar interação, ações de hoje, **exportar todos os dados de um
  cliente** e **excluir um cliente**). Cada operação exige autenticação; as destrutivas são auditadas.
- **Cliente/Lead**: entidade existente do CRM que o agente lê e escreve (contato + negócio + posição
  no funil + histórico).
- **Interação**: anotação/evento no histórico de um cliente; carrega a marcação de origem (humano/IA).
- **Registro de Auditoria**: vínculo de quem (credencial/humano) fez o quê e quando.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O dono consegue conceder acesso a um novo agente de IA e o agente realiza sua primeira
  operação autenticada no CRM em menos de 10 minutos de configuração.
- **SC-002**: 100% das operações via MCP exigem autenticação válida — zero dado do CRM é devolvido a
  credenciais ausentes, inválidas ou revogadas.
- **SC-003**: A revogação de uma credencial bloqueia o acesso daquele agente em segundos (a próxima
  requisição é negada), sem impacto nas demais credenciais.
- **SC-004**: 100% dos registros criados/alterados por agentes são corretamente atribuídos a uma
  credencial de IA — nenhum rotulado como humano e nenhum passível de falsificação.
- **SC-005**: Agentes remotos conseguem realizar **todas** as operações disponíveis às credenciais de
  máquina — leitura, escrita, exportação e exclusão — com paridade total em relação à API existente.
- **SC-006**: O dono consegue identificar, para qualquer credencial de agente, quando ela foi usada
  pela última vez.
- **SC-007**: 100% das requisições inválidas ou grandes demais são rejeitadas sem criar registros
  parciais ou corrompidos.

## Assumptions

- Na v1, o servidor MCP reaproveita o plano de autenticação de "máquina" já existente (credenciais por
  integração, revogáveis, token Bearer), com a camada de auth desenhada para receber o fluxo OAuth do
  MCP no futuro sem quebrar as credenciais já emitidas (decisão FR-014, abordagem híbrida).
- "Acesso remoto" implica um endpoint exposto na rede, protegido por transporte criptografado (TLS)
  em produção, coerente com a postura de produção já adotada (HTTPS, cookies seguros, HSTS).
- As operações expostas espelham as capacidades já existentes do CRM; esta funcionalidade não cria
  novas capacidades de negócio além do acesso remoto via MCP.
- Não há permissões finas por credencial na v1: toda credencial de agente concede acesso ao conjunto
  completo de operações, **inclusive exportar e excluir** (decisão FR-013). A contenção de uso indevido
  é a revogação imediata da credencial. Escopos por credencial ficam como desejável futuro.
- O CRM permanece uma ferramenta de dono único; multiusuário/multi-tenant está fora de escopo.
- O servidor MCP aplica as mesmas regras de validação, limite de taxa e auditoria já vigentes na API.
- Mensagens e rótulos seguem a convenção em português já adotada no projeto.

## Dependencies

- Apoia-se na infraestrutura de autenticação e auditoria já existente (credenciais de máquina,
  atribuição de autoria derivada da credencial).
- Apoia-se no modelo de dados atual de clientes e interações.
