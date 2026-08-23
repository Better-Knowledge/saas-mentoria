# Feature Specification: Resumo automático de reunião com revisão humana

**Feature Branch**: `002-resumo-reuniao-ia`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "Resumo automático de reunião: o usuário cola a transcrição e o sistema extrai decisões, próximos passos e objeções, para revisão antes de salvar"

> **Nota de escopo.** O `PRD-Reconstrucao-CRM.md` §4.2 lista "resumos de conversa gerados por IA a
> partir de transcrições" como **fora do escopo da v2**, remetendo ao `ROADMAP.md` **F2.1**. Esta
> especificação promove F2.1 a feature, numa fatia mais estreita: a transcrição é **colada pela
> pessoa**, sem depender da importação de conversas de WhatsApp (F1). As "regras inegociáveis" de
> F2.1 — sugestão nunca vira gravação automática, resumo entra como interação marcada como IA,
> minimização antes de enviar ao modelo, fonte bruta conferível — são requisitos aqui.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Transformar uma transcrição em registro revisado (Priority: P1)

Depois de uma reunião, a pessoa abre a ficha do cliente, cola o texto da transcrição e pede a
extração. Em segundos vê uma tela de revisão com três listas separadas — **decisões**, **próximos
passos** e **objeções** — além de um resumo curto em prosa. Ela lê, corrige o que ficou torto,
descarta o que não interessa e só então confirma. O que foi confirmado vira uma anotação no
histórico do cliente, marcada como gerada por IA.

**Why this priority**: é a feature inteira em uma frase. Sem ela não há valor nenhum; com ela
sozinha o usuário já troca "reler 40 minutos de transcrição" por "ler dez linhas e confirmar".

**Independent Test**: colar uma transcrição de exemplo na ficha de um cliente, verificar que a tela
de revisão traz os três tipos de item separados, editar um item, remover outro, confirmar, e
constatar que o histórico do cliente passou a exibir exatamente o conteúdo confirmado com a marca
de IA — e que nada foi gravado antes da confirmação.

**Acceptance Scenarios**:

1. **Given** uma ficha de cliente aberta e uma transcrição válida colada, **When** a pessoa solicita
   a extração, **Then** o sistema exibe uma revisão com resumo, decisões, próximos passos e
   objeções, cada item editável e removível, e **nada** foi gravado no histórico ainda.
2. **Given** uma revisão exibida, **When** a pessoa edita o texto de um item e confirma, **Then** o
   histórico do cliente registra o conteúdo **como editado**, nunca a versão original do modelo.
3. **Given** uma revisão exibida, **When** a pessoa descarta a revisão inteira, **Then** nada é
   gravado no histórico do cliente e o rascunho deixa de estar acessível.
4. **Given** uma revisão em que todos os itens foram removidos, **When** a pessoa tenta confirmar,
   **Then** o sistema impede a gravação de um registro vazio e explica o motivo.
5. **Given** uma transcrição sem conteúdo aproveitável, **When** a extração termina, **Then** cada
   lista vazia mostra um texto humano ("nenhuma decisão identificada"), nunca um bloco em branco.
6. **Given** a confirmação concluída, **When** a pessoa abre o histórico do cliente, **Then** o
   registro aparece com a marca visual de conteúdo gerado por IA.

---

### User Story 2 - Aceitar a próxima ação sugerida sem digitar (Priority: P2)

Entre os próximos passos extraídos, um costuma ser o compromisso que importa ("enviar proposta até
sexta"). Na mesma tela de revisão, a pessoa pode promover **um** desses passos a próxima ação do
cliente, com data, aceitando ou corrigindo a sugestão antes de aplicar.

**Why this priority**: é o que liga o resumo ao mecanismo anti-esquecimento do produto (tela Hoje).
Sem isso o resumo é registro passivo; com isso ele alimenta o funil. Depende da US1 existir, por
isso é P2.

**Independent Test**: numa revisão com próximos passos datados, promover um deles a próxima ação,
confirmar, e verificar que o cliente passou a aparecer na faixa correta da tela Hoje — e que
recusar a sugestão deixa a próxima ação existente intacta.

**Acceptance Scenarios**:

1. **Given** uma revisão com um próximo passo que menciona prazo, **When** a pessoa aceita a
   sugestão de próxima ação, **Then** os campos ficam preenchidos e **editáveis** antes da
   confirmação.
2. **Given** uma sugestão de próxima ação não aceita, **When** a pessoa confirma a revisão,
   **Then** a próxima ação e a data do cliente permanecem **exatamente** como estavam.
3. **Given** o cliente já possui uma próxima ação, **When** a pessoa aceita uma sugestão que a
   substitui, **Then** o sistema avisa que há uma ação vigente e exige confirmação explícita.
4. **Given** uma data sugerida em formato ou valor inválido, **When** a pessoa tenta aplicar,
   **Then** a aplicação é recusada com mensagem clara e nada é alterado no cliente.
5. **Given** qualquer campo de negócio (valor, etapa, resultado, tipo), **When** a extração termina,
   **Then** nenhum deles é alterado sem ação humana explícita — a extração nunca escreve sozinha.

---

### User Story 3 - Conferir a fonte e a autoria do que foi registrado (Priority: P3)

Quem lê o histórico semanas depois precisa saber de onde aquele resumo veio, se foi um humano ou uma
IA que escreveu, e o que exatamente a pessoa aceitou naquele momento.

**Why this priority**: é a garantia de confiança do produto e o que sustenta a exigência de
auditoria. Não bloqueia o uso diário, por isso P3 — mas é condição para tratar dado de cliente real.

**Independent Test**: confirmar uma revisão, depois inspecionar o registro resultante e a trilha de
auditoria, verificando que constam o autor, o momento e o fato de o conteúdo ter passado por revisão
humana; e que descartar uma revisão não deixa registro de conteúdo, apenas do descarte.

**Acceptance Scenarios**:

1. **Given** um registro criado por esta feature, **When** ele é consultado, **Then** consta que foi
   gerado por IA e revisado por uma pessoa identificada, com data e hora.
2. **Given** uma revisão em que a pessoa alterou itens, **When** a trilha de auditoria é consultada,
   **Then** consta que houve edição humana antes da gravação, sem que a trilha reproduza dados
   pessoais de terceiros presentes na transcrição.
3. **Given** uma próxima ação aplicada a partir de uma sugestão, **When** a trilha é consultada,
   **Then** a alteração do campo aparece com valor anterior e novo, atribuída à pessoa que
   confirmou — **não** à IA.
4. **Given** um registro confirmado por automação sem revisão humana, **When** o histórico é
   consultado, **Then** ele é visualmente distinguível de um registro revisado, e a trilha registra
   que não houve revisão.
5. **Given** um registro com mais de 90 dias, **When** a ficha é consultada, **Then** o registro
   revisado continua lá e a transcrição de origem já não está disponível.

---

### Edge Cases

- **Transcrição longa demais**: acima do limite aceito, o sistema recusa antes de processar,
  informando o tamanho máximo — nunca trunca em silêncio.
- **Transcrição vazia ou só com ruído** ("ok", "tudo bem?"): a extração conclui com listas vazias e
  texto humano explicando que não houve conteúdo aproveitável.
- **Falha ou indisponibilidade do serviço de extração**: a pessoa recebe erro claro, a transcrição
  colada **não se perde** da tela, e nenhum registro parcial é gravado.
- **Demora acima do esperado**: a espera tem retorno visual e um limite; estourado o limite, a
  operação é cancelada com mensagem, sem deixar rascunho pendurado.
- **Duas extrações seguidas do mesmo cliente**: a segunda revisão não sobrescreve silenciosamente a
  primeira pendente; o sistema deixa explícito qual rascunho está em revisão.
- **Sessão expira durante a revisão**: ao voltar, a pessoa é levada ao login e o conteúdo em revisão
  não fica visível na tela para quem sentar no navegador em seguida.
- **Conteúdo hostil na transcrição** (texto que imita marcação ou instrução): é tratado como texto
  puro na exibição e não altera o comportamento do sistema nem da extração.
- **Cliente excluído durante a revisão**: a confirmação falha com mensagem clara em vez de criar um
  registro órfão.
- **Item extraído longo demais**: é recusado ou truncado com aviso visível na revisão, nunca gravado
  além do limite de tamanho do histórico.
- **Serviço de IA não configurado**: a funcionalidade se apresenta indisponível com mensagem clara;
  nenhuma outra parte do produto é afetada.
- **Transcrição expirada consultada**: quem abre um registro com mais de 90 dias vê o conteúdo
  revisado e uma indicação de que a fonte já foi descartada — nunca um erro seco.
- **Automação confirmando sem revisão**: o registro entra marcado como não revisado; a distinção
  precisa sobreviver a qualquer caminho de leitura da ficha.

## Requirements *(mandatory)*

### Functional Requirements

**Entrada e extração**

- **FR-001**: O sistema MUST permitir colar uma transcrição em texto livre a partir da ficha de um
  cliente existente e solicitar a extração.
- **FR-002**: O sistema MUST recusar transcrições acima do tamanho máximo aceito, com mensagem que
  informe o limite, antes de qualquer processamento.
- **FR-003**: O sistema MUST produzir, a partir da transcrição, quatro saídas: um **resumo** em prosa
  curta, uma lista de **decisões**, uma lista de **próximos passos** e uma lista de **objeções**.
- **FR-004**: Cada próximo passo MUST poder carregar um responsável e um prazo quando a transcrição
  os declarar, e MUST ficar sem eles quando não declarar — o sistema não inventa prazo.
- **FR-005**: O sistema MUST minimizar os dados enviados ao serviço de extração: telefones e
  e-mails identificáveis são mascarados antes do envio, e nenhum dado de outros clientes é incluído.
- **FR-006**: O sistema MUST tratar falha, indisponibilidade ou demora excessiva do serviço de
  extração como erro recuperável: mensagem clara, transcrição preservada na tela, nenhum registro
  parcial gravado.

**Revisão antes de salvar**

- **FR-007**: No plano humano (navegador), o sistema MUST exibir o resultado da extração numa etapa
  de revisão e MUST NOT gravar nada no histórico do cliente antes da confirmação humana explícita.
  O plano de máquina é regido por FR-028 e seguintes.
- **FR-008**: Na revisão, a pessoa MUST poder editar o texto de qualquer item, remover itens
  individualmente e acrescentar itens que a extração não pegou.
- **FR-009**: O sistema MUST gravar o conteúdo **como revisado**, nunca a versão original da
  extração, quando houver edição.
- **FR-010**: O sistema MUST permitir descartar a revisão inteira, sem gravar conteúdo no histórico.
- **FR-011**: O sistema MUST impedir a confirmação de uma revisão sem nenhum item e sem resumo,
  explicando o motivo.
- **FR-012**: O sistema MUST deixar explícito, na revisão, que o conteúdo foi produzido por IA e
  ainda não foi salvo.

**Gravação e efeitos**

- **FR-013**: Ao confirmar, o sistema MUST registrar o conteúdo revisado no histórico de interações
  do cliente, marcado como gerado por IA.
- **FR-014**: A confirmação MUST atualizar a data de última movimentação do cliente, como qualquer
  interação registrada.
- **FR-015**: O sistema MUST NOT alterar qualquer campo de negócio do cliente (valor estimado,
  etapa, resultado, tipo, proposta, status de pagamento) como efeito da extração.
- **FR-016**: O sistema MUST permitir promover **um** próximo passo a próxima ação do cliente, com
  data, apenas mediante ação humana explícita, com os valores editáveis antes de aplicar.
- **FR-017**: Quando o cliente já tiver próxima ação definida, substituí-la a partir de uma sugestão
  MUST exigir confirmação adicional que mostre o valor vigente.
- **FR-018**: Datas aplicadas a partir de sugestão MUST passar pela mesma validação de data do
  restante do produto; valor inválido é recusado sem alterar o cliente.

**Autoria, auditoria e privacidade**

- **FR-019**: A autoria do registro MUST ser derivada da credencial autenticada, nunca de campo
  enviado pelo cliente da requisição.
- **FR-020**: O registro resultante MUST identificar tanto a origem automática do conteúdo quanto a
  pessoa que o revisou e confirmou, com data e hora.
- **FR-021**: Alterações em campos do cliente decorrentes de sugestão aceita MUST ser atribuídas na
  trilha de auditoria à **pessoa que confirmou**, não à IA.
- **FR-022**: A trilha de auditoria MUST NOT reproduzir o conteúdo da transcrição nem dados pessoais
  de terceiros nela presentes.
- **FR-023**: Todo texto exibido na revisão e no histórico MUST ser apresentado como texto puro,
  sem que conteúdo da transcrição possa alterar a interface.
- **FR-024**: A operação MUST exigir credencial válida; sem credencial não há extração nem gravação.
- **FR-025**: Rascunhos em revisão MUST ser visíveis apenas a quem os criou e MUST deixar de estar
  acessíveis na interface quando a sessão terminar ou expirar.
- **FR-026**: A transcrição bruta MUST ser guardada junto ao registro criado, vinculada a ele, e
  MUST ficar acessível para conferência a quem tem acesso à ficha do cliente.
- **FR-026a**: A transcrição guardada MUST ser descartada automaticamente **90 dias** após a
  gravação do registro, sem intervenção manual; o registro revisado permanece.
- **FR-026b**: A transcrição MUST ser apagada imediatamente, antes do prazo, quando o cliente
  associado for excluído.
- **FR-026c**: A transcrição MUST NOT ser incluída na exportação de dados do titular; a exportação
  continua entregando ficha, interações e histórico, incluindo o registro revisado.
- **FR-026d**: O sistema MUST informar na interface, no momento de colar, que a transcrição ficará
  guardada por 90 dias — a pessoa que cola precisa saber o que está fazendo com a fala de terceiros.
- **FR-027**: A extração MUST ser realizada pelo próprio sistema, acionando um serviço externo de
  IA a partir do servidor.
- **FR-027a**: A credencial do serviço de IA MUST ficar apenas no servidor, nunca alcançável pelo
  navegador nem exposta em resposta de API.
- **FR-027b**: O sistema MUST tolerar a ausência de configuração do serviço de IA: sem ele, a
  funcionalidade se apresenta indisponível com mensagem clara e o restante do produto segue normal.
- **FR-028**: A capacidade MUST ser exposta também a credenciais de máquina, que MAY criar e
  confirmar o próprio registro sem revisão humana.
- **FR-028a**: Registro confirmado por credencial de máquina MUST ser gravado como **não revisado
  por humano**, visualmente distinguível no histórico de um registro que passou por revisão.
- **FR-028b**: A trilha de auditoria MUST distinguir os dois casos, registrando explicitamente
  quando a confirmação ocorreu sem revisão humana.
- **FR-028c**: A regra de FR-015 permanece válida em ambos os planos: confirmar um registro
  MUST NOT alterar campo de negócio do cliente. Uma automação que queira mudar próxima ação, valor
  ou etapa MUST fazê-lo por uma operação separada e explícita, que já existe no produto.

**Estados e retorno**

- **FR-029**: Toda lista vazia na revisão MUST exibir texto humano explicando a ausência.
- **FR-030**: Toda ação (extrair, confirmar, descartar, aplicar sugestão) MUST ter retorno visual de
  sucesso ou erro, com a mensagem do sistema.
- **FR-031**: A espera pela extração MUST ter indicação visível de progresso e um limite de tempo
  após o qual a operação é cancelada com mensagem.

### Key Entities

- **Transcrição**: texto bruto de uma reunião, colado por uma pessoa, associado ao registro que
  originou. Pode conter dados pessoais de terceiros e informação comercial sigilosa. Vive **90 dias**
  a partir da gravação do registro, ou menos se o cliente for excluído antes. Não sai na exportação
  do titular.
- **Rascunho de revisão**: resultado da extração aguardando decisão humana. Pertence a quem o criou,
  não é conteúdo do cliente até ser confirmado, e desaparece ao ser confirmado ou descartado.
- **Item extraído**: uma unidade do rascunho, de um dos três tipos — **decisão**, **próximo passo**
  ou **objeção**. Próximo passo pode ter responsável e prazo. Todo item é editável e removível.
- **Registro de reunião**: a interação criada no histórico do cliente ao confirmar a revisão,
  marcada como gerada por IA, com o conteúdo revisado.
- **Sugestão de próxima ação**: proposta de texto e data derivada de um próximo passo; só afeta o
  cliente por ação humana explícita.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pessoa transforma uma transcrição de reunião em registro salvo no histórico em menos
  de **2 minutos**, contra a leitura integral da transcrição.
- **SC-002**: **95%** das extrações devolvem a revisão em até **30 segundos**; nenhuma passa de
  **60 segundos** sem cancelar com mensagem.
- **SC-003**: Em **100%** dos casos, nenhum conteúdo chega ao histórico do cliente sem confirmação
  humana — verificável descartando revisões e constatando histórico inalterado.
- **SC-004**: Em **100%** dos casos, nenhum campo de negócio do cliente é alterado sem ação humana
  explícita.
- **SC-005**: **≥ 70%** dos itens extraídos são aceitos sem edição, medido sobre um corpus de
  referência versionado no repositório — cinco transcrições anonimizadas com o resultado esperado
  registrado ao lado — por um procedimento de medição executável e repetível, com a taxa apurada e
  datada junto à documentação do produto.
- **SC-006**: **100%** dos registros criados por esta feature são identificáveis como gerados por IA
  e rastreáveis até a pessoa que os confirmou.
- **SC-007**: Nenhum telefone ou e-mail identificável presente na transcrição sai do sistema sem
  mascaramento, verificável por inspeção da carga enviada.
- **SC-008**: Falha do serviço de extração **não** produz registro parcial nem perda do texto colado,
  em **100%** das ocorrências simuladas.
- **SC-009**: A pessoa consegue concluir todo o fluxo — colar, extrair, revisar, confirmar — apenas
  pelo teclado.
- **SC-010**: **100%** das transcrições com mais de 90 dias deixaram de existir no sistema,
  verificável por inspeção após a rotina de descarte.
- **SC-011**: **100%** das exportações de dados do titular saem sem transcrição bruta e com os
  registros revisados presentes.
- **SC-012**: **100%** dos registros criados sem revisão humana são distinguíveis dos revisados na
  ficha do cliente e na trilha de auditoria.

## Assumptions

- A transcrição é colada como **texto**; upload de áudio, upload de arquivo e transcrição automática
  de gravação estão fora do escopo desta feature (`ROADMAP.md` F2.2).
- O fluxo parte de um **cliente já existente**; criar cliente novo a partir de uma transcrição está
  fora do escopo.
- A extração produz **um único registro** no histórico por transcrição confirmada, contendo o resumo
  e os itens — e não um registro por item.
- Apenas **um** próximo passo pode virar a próxima ação do cliente por confirmação, porque o produto
  tem um único campo de próxima ação.
- Somente o autor do rascunho o revisa; não há revisão colaborativa nem fila de aprovação.
- O idioma de trabalho é o **português do Brasil**, tanto na transcrição quanto na saída.
- O limite de tamanho do conteúdo salvo respeita o limite já vigente para anotações do histórico;
  o limite da transcrição de entrada é maior e definido no planejamento.
- O serviço de extração usado **não treina com os dados enviados**, conforme o compromisso de LGPD
  já assumido pelo produto — é critério de escolha, não detalhe de implementação.
- A feature reaproveita o histórico de interações, a marcação de autoria humano×IA, a próxima ação
  com data e a trilha de auditoria que já existem; nenhuma dessas mecânicas é recriada.
- Esta feature promove o item **F2.1** do `ROADMAP.md`, hoje fora do escopo da v2 pelo
  `PRD-Reconstrucao-CRM.md` §4.2. A promoção é decisão do responsável pelo produto.

### Decisões tomadas nas clarificações (2026-08-23)

- **Extração no próprio sistema (Q1 → A).** O produto passa a depender de um serviço externo de IA,
  com custo por uso e disponibilidade fora do seu controle — a primeira dependência de terceiro do
  CRM. Exige justificativa registrada na Complexity Tracking do plano, conforme o Princípio VI da
  constituição.
- **Transcrição retida por 90 dias, fora da exportação do titular (Q2 → C, ajustado).** Escolha
  explícita do responsável pelo produto. Consequência a registrar com honestidade: a transcrição
  contém falas do **próprio titular**, além de terceiros; mantê-la 90 dias e excluí-la da exportação
  significa que existe, nesse período, dado do titular no sistema que a exportação não entrega. A
  exclusão do cliente continua apagando tudo, inclusive a transcrição (FR-026b). Se a intenção era
  minimizar o que sai do sistema, a alternativa coerente seria não reter a transcrição; se era
  preservar a fonte para conferência, o coerente seria incluí-la na exportação. A decisão registrada
  aqui é a primeira, e o `SEGURANCA.md` deve receber a justificativa na revisão da fase.
- **Automação pode confirmar sem revisão humana (Q3 → C).** Escolha explícita do responsável pelo
  produto, adotada com um controle compensatório que não estava na pergunta: todo registro
  confirmado por credencial de máquina é gravado e exibido como **não revisado por humano**
  (FR-028a, FR-028b). Isso preserva a paridade REST↔MCP exigida pelo Princípio V sem apagar, para
  quem lê a ficha meses depois, a diferença entre o que uma pessoa conferiu e o que nenhuma pessoa
  viu. A proibição de alterar campo de negócio sem ação explícita continua valendo nos dois planos
  (FR-028c) — é o que impede que um erro de leitura do modelo vire uma proposta errada.

## Dependencies

- Ficha de cliente com histórico de interações e marcação de autoria (produto v2, RF-16 a RF-19).
- Próxima ação com data e a tela Hoje que a consome (RF-08, RF-20 a RF-23).
- Trilha de auditoria de alterações (RF-84, RF-85).
- Um serviço externo de extração de linguagem natural, acionado pelo servidor — **primeira
  dependência de terceiro do produto**, com custo por uso, segredo a guardar e disponibilidade fora
  do controle do sistema. Exige registro de justificativa na Complexity Tracking do plano e escolha
  de provedor que não treine com os dados enviados.
- Uma rotina de descarte automático capaz de rodar sem intervenção manual, para cumprir os 90 dias
  de retenção da transcrição (FR-026a).
