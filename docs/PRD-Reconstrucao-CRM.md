# PRD — Reconstrução do Mini CRM

> **Produto:** Mini CRM — Consultoria & IA Generativa
> **Versão do documento:** 2.1 (reconstrução completa, revisada contra o código)
> **Autor:** Farley — Consultor, Professor e Desenvolvedor de soluções em IA Generativa
> **Data:** 16/08/2026
> **Status:** aprovado para construção
> **Substitui:** [`PRD.md`](PRD.md) (v1, 31/05/2026)

> **Revisão 2.1 — auditoria de cobertura contra a base de código.** Acrescentados os requisitos
> `RF-87` a `RF-102` e `RNF-16` a `RNF-19`, que cobrem validação de entrada, escape de saída,
> higiene de sessão no front, recuperação de acesso e operação (health, log, backup, dados de
> exemplo). Três requisitos foram **corrigidos por descreverem o sistema melhor do que ele é**:
> `RNF-02` (a CSP real carrega `'unsafe-inline'`), `RF-54` (o spec é 3.0.3, não 3.1) e `RF-15` (a
> rejeição de enum inválido só acontece em um dos três caminhos de escrita). `RF-56` foi alinhado à
> nomenclatura real do contrato e `RF-64` ganhou a lista de exclusão sem a qual era inimplementável.

---

## 0. Como ler este documento

Este PRD é escrito para ser **executável por um agente de IA** (Claude Code, Cursor, Codex) e
compreensível por uma pessoa. Cada requisito funcional tem um identificador estável (`RF-xx`), cada
requisito não funcional tem `RNF-xx`, e a seção 14 lista os **critérios de aceite** que precisam
passar antes de considerar o produto pronto.

A regra de ouro da reconstrução: **nada entra no produto que não esteja aqui**. Se durante a
construção aparecer uma necessidade nova, ela vira uma linha no [`ROADMAP.md`](ROADMAP.md) — não um
puxadinho no código.

---

## 1. Contexto e problema

Atendo **empresas (B2B), profissionais autônomos e setor público/instituições**, vendendo
consultoria e projetos, cursos e mentorias, desenvolvimento de soluções, palestras e workshops.

Os contatos chegam por **WhatsApp, Instagram, LinkedIn, indicação e eventos** — cada canal com sua
própria caixa de entrada e nenhuma memória compartilhada entre eles. O prejuízo é concreto e
recorrente:

| Sintoma | Custo real |
|---|---|
| Follow-up esquecido | Lead esfria e some sem nunca ter dito "não" |
| Histórico perdido | Reunião começa do zero, transmitindo desorganização |
| Sem visão de etapa | Não sei onde estou perdendo negócios, então não sei o que corrigir |
| Proposta sem retorno | Dinheiro parado sem ninguém cobrando |

**Objetivo do produto:** centralizar clientes em um lugar só, deixar óbvio em que etapa cada um
está, garantir que **todo negócio ativo tenha uma próxima ação com data** — e permitir que
**agentes de IA operem o CRM com as mesmas capacidades de uma pessoa**, com autoria auditável.

### 1.1 Por que reconstruir em vez de evoluir

A v1 provou o conceito e revelou quatro limites estruturais que são mais baratos de resolver na
fundação do que remendar depois:

1. **Sem histórico de etapa.** O schema guarda apenas a etapa *atual*, então taxa de conversão
   entre etapas e tempo médio por etapa são impossíveis de calcular. Isso exige uma tabela nova e
   um ponto único de escrita — mudança de fundação, não de tela.
2. **`origem` é texto livre.** `indicação` e `Indicação` viram duas categorias no dashboard. Precisa
   virar lista controlada com opção "outra".
3. **Sem trilha de auditoria de alterações.** Sabemos quem *criou* cada registro, nunca quem
   *alterou* o quê. Com IA escrevendo no sistema, isso passa de desejável a obrigatório.
4. **Sem testes automatizados.** A v1 foi validada manualmente. Com integrações externas chegando
   (WhatsApp, campanhas), verificação manual deixa de escalar.
5. **Validação de entrada incompleta, com falhas silenciosas.** `tipo_cliente` aceita qualquer
   string; `etapa` e `resultado` inválidos são **coagidos em silêncio** no caminho de criar/atualizar
   (mas rejeitados em mover); e-mail, telefone e data não têm validação de formato. Uma data fora de
   `YYYY-MM-DD` some da tela Hoje sem erro nenhum — o mecanismo anti-esquecimento falhando em
   silêncio é o defeito mais caro da lista.
6. **A CSP não protege o que diz proteger.** A política real carrega `'unsafe-inline'` em
   `script-src` e `script-src-attr`, porque o front usa `onclick` nos elementos gerados. Trocar por
   delegação de eventos exige reescrever o front — que é exatamente o que uma reconstrução faz.

Somando: **preserva-se tudo que funciona** (o modelo de duas credenciais, a camada de serviço
compartilhada, o dashboard em quatro camadas) e **corrige-se a fundação** antes que o roadmap de
integrações seja empilhado sobre ela.

---

## 2. Usuários e personas

| Persona | Quem é | O que precisa | Como acessa |
|---|---|---|---|
| **Dono / Admin** | Farley | Ver o dia, mover o funil, fechar negócio, administrar acessos e chaves | Interface web, login e senha |
| **Assistente** | Pessoa de apoio comercial | Cadastrar leads, registrar conversas, agendar follow-up | Interface web, login e senha |
| **Agente de IA** | Claude/GPT via MCP, n8n, automação própria | Criar leads que chegaram por canal externo, registrar resumos, consultar métricas, sugerir follow-ups | API REST ou MCP, chave Bearer |
| **Titular dos dados** | O cliente cadastrado | Que seus dados sejam exportáveis e apagáveis sob pedido (LGPD) | Indiretamente, via admin |

> **Decisão de arquitetura de produto:** a interface é para pessoas, a API e o MCP são para máquinas.
> Os dois planos compartilham exatamente a mesma lógica de domínio e as mesmas regras de validação —
> nunca duas implementações do mesmo comportamento.

---

## 3. Metas e métricas de sucesso

| Meta | Métrica | Alvo |
|---|---|---|
| Nenhum follow-up perdido | % de negócios em aberto com `proxima_acao_data` preenchida | ≥ 95% |
| Proposta nunca esquecida | % de propostas enviadas com desfecho em até 30 dias | ≥ 90% |
| Histórico acessível | Tempo para abrir a ficha completa de um cliente | < 3 s |
| IA operando de verdade | % de interações registradas por agente de IA | ≥ 30% em 90 dias |
| Previsibilidade | Pipeline ponderado disponível e comparável mês a mês | Sempre |

---

## 4. Escopo

### 4.1 Dentro do escopo (v2)

Tudo que a v1 entrega, mais as correções de fundação:

- Gestão de clientes/leads com funil Kanban de 4 etapas e desfecho ganho/perdido
- Histórico de interações por cliente, com marcação de autoria (humano × IA)
- Próxima ação com data — o mecanismo anti-esquecimento
- Tela "Hoje" (atrasados, hoje, próximos)
- Dashboard em quatro camadas (KPIs, evolução, composição, atenção)
- Multiusuário com papéis `admin` e `assistente`
- Autenticação em dois planos: sessão em cookie para pessoas, chave de API para máquinas
- **API REST documentada em OpenAPI 3.1**, servida por interface interativa
- **Servidor MCP autenticado** com paridade total com a API
- Exportação e exclusão de dados por titular (LGPD)
- **NOVO:** histórico de mudanças de etapa (habilita conversão e tempo por etapa)
- **NOVO:** trilha de auditoria de alterações (quem mudou o quê, quando, por qual credencial)
- **NOVO:** `origem` como lista controlada com opção "outra"
- **NOVO:** suíte de testes automatizados

### 4.2 Fora do escopo (v2)

Vai para o [`ROADMAP.md`](ROADMAP.md), com fase e justificativa:

- Integração com WhatsApp (Evolution API Cloud, Z-API), handoff de conversas e campanhas
- Resumos de conversa gerados por IA a partir de transcrições
  > **Promovido em 23/08/2026.** A fatia "colar transcrição → revisar → salvar" saiu deste
  > "fora do escopo" e virou a feature `002-resumo-reuniao-ia` (ver `specs/002-resumo-reuniao-ia/`).
  > O restante do item — resumo a partir de conversa importada, sugestão de valor e
  > enriquecimento contínuo — segue fora do escopo da v2, em `ROADMAP.md` F2.
- Envio de propostas, orçamentos e documentos pelo sistema
- Lembretes saindo para e-mail e Google Agenda
- Permissões granulares além de `admin` / `assistente`
- Multi-tenant (várias empresas na mesma instalação)
- Aplicativo móvel nativo

---

## 5. Requisitos funcionais

### 5.1 Clientes e negócios

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-01** | Cadastrar cliente com nome (obrigatório), empresa, cargo, telefone, e-mail, tipo (`b2b`/`autonomo`/`publico`) e origem | Must |
| **RF-02** | Listar clientes ordenados pela última movimentação, com contagem de interações | Must |
| **RF-03** | Buscar clientes por nome ou empresa, com filtro aplicado no cliente sem recarregar | Must |
| **RF-04** | Abrir ficha completa: dados de contato, negócio e histórico de interações | Must |
| **RF-05** | Editar qualquer campo do cliente por whitelist explícita — **nunca mass assignment** | Must |
| **RF-06** | Excluir cliente, apagando em cascata suas interações e histórico | Must |
| **RF-07** | Registrar valor estimado, proposta enviada (sim/não) e status de pagamento | Must |
| **RF-08** | Definir próxima ação (texto) e data da próxima ação (`YYYY-MM-DD`) | Must |
| **RF-09** | `origem` selecionada de lista controlada (Indicação, Instagram, LinkedIn, WhatsApp, Evento, Site, Outra), com campo livre apenas quando "Outra" | Must — **novo na v2** |
| **RF-87** | `tipo_cliente` **validado contra o enum** (`b2b`/`autonomo`/`publico`); valor fora da lista → `400` | Must — **corrige defeito da v1** |
| **RF-88** | `email` validado por formato e `telefone` normalizado; formato inválido → `400` com mensagem clara | Must — **corrige defeito da v1** |
| **RF-89** | `proxima_acao_data` e demais datas validadas no formato `YYYY-MM-DD`; formato diferente → `400` | Must — **corrige defeito da v1** |

> **Defeitos herdados da v1 corrigidos aqui.** Hoje `montaCliente` grava qualquer string em
> `tipo_cliente` sem validar, e não há validação de formato para e-mail, telefone ou data. O caso da
> data é o mais traiçoeiro: a tela Hoje compara `proxima_acao_data` **como texto**, então um valor
> em `DD/MM/AAAA` não gera erro — ele simplesmente desaparece da classificação atrasado/hoje/futuro.
> Falha silenciosa em campo que sustenta o mecanismo anti-esquecimento é o pior tipo de defeito.

### 5.2 Funil

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-10** | Quadro Kanban com 4 etapas: `novo` → `qualificacao` → `reuniao` → `proposta` | Must |
| **RF-11** | Mover cartão entre colunas por arrastar-e-soltar, persistindo imediatamente | Must |
| **RF-12** | Definir resultado do negócio: `em_aberto`, `ganho`, `perdido` | Must |
| **RF-13** | Carimbar `fechado_em` na transição de resultado: fechar grava a data de hoje, reabrir limpa, corrigir `ganho`↔`perdido` **mantém a data original** | Must |
| **RF-14** | **Toda** mudança de etapa ou resultado gera um registro em `historico_etapas` com etapa anterior, nova, timestamp e autor | Must — **novo na v2** |
| **RF-15** | Etapas inválidas e resultados inválidos são rejeitados com `400` e mensagem clara, **em todos os caminhos de escrita** | Must — **muda comportamento da v1** |

> **Atenção: RF-15 é mudança, não descrição.** Na v1 o comportamento é inconsistente — `moverEtapa`
> lança `400`, mas `criarCliente` e `atualizarCliente` fazem **coerção silenciosa** para `novo` /
> `em_aberto` (`ETAPAS.includes(body.etapa) ? body.etapa : 'novo'`). Um agente que envie
> `etapa: "negociacao"` recebe `201` e acredita que funcionou. A v2 unifica: rejeitar sempre.

### 5.3 Interações

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-16** | Adicionar anotação de texto livre (≤ 5000 caracteres) a um cliente | Must |
| **RF-17** | Listar interações de um cliente, mais recentes primeiro | Must |
| **RF-18** | Marcar visualmente as interações geradas por IA (badge), derivado da credencial | Must |
| **RF-19** | Registrar uma interação atualiza o `updated_at` do cliente | Must |

### 5.4 Tela Hoje

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-20** | Classificar negócios em aberto com data em: **atrasados** (< hoje), **hoje** (= hoje), **próximos** (> hoje) | Must |
| **RF-21** | Cartões de resumo no topo com a contagem de cada faixa | Must |
| **RF-22** | Clicar em qualquer item abre a ficha do cliente | Must |
| **RF-23** | Estado vazio com texto humano, nunca uma lista em branco | Must |

### 5.5 Dashboard

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-24** | **Camada 1 — KPIs:** pipeline em aberto, pipeline ponderado, taxa de vitória, ticket médio, ciclo médio de vendas, receita ganha | Must |
| **RF-25** | Pipeline ponderado multiplica o valor pelo peso da etapa (`novo` 10% · `qualificacao` 25% · `reuniao` 50% · `proposta` 75%), com os pesos em constante única e documentada | Must |
| **RF-26** | **Camada 2 — Evolução:** ganhos × perdidos por mês, receita ganha acumulada, novos leads por mês, proporção de cadastros por IA e por pessoas — série contínua incluindo meses vazios | Must |
| **RF-27** | **Camada 3 — Composição:** valor parado por etapa, origem dos leads medida **por valor ganho** (não por volume), tipo de cliente | Must |
| **RF-28** | **Camada 4 — Precisa de atenção:** sem próxima ação agendada, parados há 30+ dias, propostas enviadas ainda em aberto — cada item clicável | Must |
| **RF-29** | **Taxa de conversão entre etapas**, calculada a partir de `historico_etapas` | Must — **novo na v2** |
| **RF-30** | **Tempo médio em cada etapa**, calculado a partir de `historico_etapas` | Must — **novo na v2** |
| **RF-31** | Gráficos em SVG gerado no próprio front, sem biblioteca externa e sem afrouxar a CSP | Must |
| **RF-32** | Avisar na tela quando a base de dados for pequena demais para a métrica ser confiável | Should |

### 5.6 Usuários e acessos

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-33** | Primeiro admin criado no boot a partir de variáveis de ambiente, se não houver nenhum usuário | Must |
| **RF-34** | Admin cadastra, edita, redefine senha e exclui usuários pela interface | Must |
| **RF-35** | Papéis: `admin` (usa o CRM + administra) e `assistente` (usa o CRM) | Must |
| **RF-36** | Carteira compartilhada — todos veem os mesmos leads; a autoria fica registrada por linha | Must |
| **RF-37** | Recusar excluir a própria conta | Must |
| **RF-38** | Recusar excluir ou rebaixar o **último administrador** | Must |
| **RF-39** | Mudança de papel vale imediatamente, sem novo login (papel lido do banco a cada requisição) | Must |
| **RF-40** | Admin redefinir senha de alguém derruba **todas** as sessões daquela pessoa | Must |
| **RF-41** | Trocar a própria senha exige a senha atual, derruba as **outras** sessões e mantém a atual | Must |
| **RF-42** | Senha mínima de 8 caracteres, guardada com hash bcrypt (custo ≥ 12) | Must |
| **RF-90** | **Recuperação de acesso fora da interface:** script executável no servidor que redefine a senha do admin a partir do `.env` e encerra as sessões dele. Se ninguém consegue entrar, esta é a única saída sem editar o banco à mão | Must |
| **RF-91** | Sessões expiradas removidas em lote periodicamente, não apenas quando alguém tenta usá-las | Should |

### 5.7 Integrações — chaves de API

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-43** | Admin cria chave de API nomeada por integração; o segredo é exibido **uma única vez** | Must |
| **RF-44** | Somente o hash da chave é armazenado — nunca o segredo | Must |
| **RF-45** | Revogar uma chave individualmente, sem afetar as demais | Must |
| **RF-46** | Registrar o `ultimo_uso` de cada chave | Must |
| **RF-47** | Listar chaves mostrando nome, prefixo visível, estado e último uso | Must |
| **RF-92** | Excluir um usuário **não** revoga as chaves que ele criou (`criada_por` vira `NULL`) — a chave pertence à integração, não à pessoa. A interface avisa disso no momento da exclusão | Must |

### 5.8 API REST

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-48** | **Todos** os endpoints exigem autenticação — inclusive leitura e exportação. Não existe rota anônima de dados | Must |
| **RF-49** | Aceitar dois tipos de credencial: sessão em cookie (pessoas) e `Authorization: Bearer` (máquinas) | Must |
| **RF-50** | Escritas por sessão exigem token CSRF no header `X-CSRF-Token`, comparado em tempo constante | Must |
| **RF-51** | Escritas por chave de API são gravadas com autoria `ia`, **derivada da credencial** — nunca de um campo do corpo ou de um header | Must |
| **RF-52** | Erros de domínio retornam `400`/`403`/`404`/`409` com `{ "erro": "mensagem" }`; nunca `500` genérico para erro de negócio | Must |
| **RF-53** | Endpoints mínimos: clientes (CRUD), etapa, interações (listar/criar), hoje, dashboard, export, usuários, chaves | Must |

### 5.9 Documentação OpenAPI

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-54** | Manter um arquivo **`openapi.yaml`** em **OpenAPI 3.1**, versionado no repositório, cobrindo **100%** das rotas públicas da API | Must — **migração; hoje é 3.0.3** |
| **RF-55** | Cada operação declara: `operationId`, `summary`, `description`, `tags`, parâmetros, corpo, **todos** os códigos de resposta e o esquema de segurança aplicável | Must |
| **RF-56** | Reuso em `components/`: **`schemas`** (`Lead`, `NovoLead`, `AtualizaLead`, `LeadResumo`, `Interacao`, `NovaInteracao`, `Usuario`, `ApiKey`, `DashboardResponse`, `HojeResponse`, `Erro`), **`parameters`** (`IdLead`) e **`responses`** (`Erro400`, `Erro401`, `Erro403Csrf`, `Erro403Admin`, `Erro404`) — sem repetição de estrutura inline | Must |

> **Sobre a versão 3.1.** O spec atual é `3.0.3`. Migrar é decisão desta reconstrução, não descrição
> do que existe: 3.1 alinha-se ao JSON Schema, o que permite gerar os schemas do OpenAPI e os
> `inputSchema` das ferramentas MCP a partir da mesma fonte em vez de mantê-los em paralelo. A
> migração exige revisar `nullable: true` (vira `type: [x, 'null']`) e os `example` isolados.

> **Sobre a nomenclatura.** O contrato chama a entidade de **`Lead`**; o banco chama a tabela de
> **`clientes`**. É proposital e vem da v1: "lead" é a palavra do domínio comercial, "cliente" é a
> do schema. Mantida por compatibilidade — renomear quebraria integrações já emitidas.
| **RF-57** | Dois `securitySchemes`: `bearerAuth` (chave de API) e `cookieAuth` (sessão), aplicados por operação conforme quem pode chamá-la | Must |
| **RF-58** | Exemplos de request e response em toda operação de escrita | Must |
| **RF-59** | Documentação interativa navegável em **`/docs`**, servida pelo próprio app | Must |
| **RF-60** | O bundle da documentação é servido **localmente**, nunca de CDN — a CSP permite apenas `'self'` em `script-src` e não deve ser afrouxada para uma página de documentação | Must |
| **RF-61** | Fontes remotas da ferramenta de documentação desligadas; a página usa a mesma tipografia do app | Must |
| **RF-62** | O spec cru fica acessível em **`/openapi.yaml`** para consumo por ferramentas e geradores de client | Must |
| **RF-63** | O spec é **validado no boot** — servidor não sobe com OpenAPI inválido | Must |
| **RF-64** | Um teste automatizado garante que **toda rota registrada no Express existe no spec** e vice-versa (paridade rota ↔ documentação), com uma **lista de exclusão explícita e versionada**: `/mcp` (JSON-RPC, documentado em `docs/MCP.md`), `/docs`, `/docs/scalar.js`, `/openapi.yaml`, `/api-docs` e o estático de `public/`. Entrada nova na lista de exclusão exige justificativa no próprio arquivo de teste | Must — **novo na v2** |
| **RF-65** | Caminhos antigos de documentação redirecionam com `301`, sem quebrar links já compartilhados | Should |

### 5.10 Servidor MCP

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-66** | Expor um servidor **MCP (Model Context Protocol)** em `POST /mcp`, transporte **Streamable HTTP**, no mesmo processo Express | Must |
| **RF-67** | O endpoint exige `Authorization: Bearer` válido — **sem credencial, `401`; nunca modo anônimo** | Must |
| **RF-68** | Reaproveitar as chaves de API já emitidas na tela Integrações; sem plano de credencial paralelo | Must |
| **RF-69** | A resolução de credencial fica isolada atrás de uma única função, para que OAuth do MCP possa ser plugado depois sem invalidar as chaves existentes | Must |
| **RF-70** | **Paridade total com a API**: toda operação de negócio disponível via REST tem ferramenta MCP equivalente — incluindo exportar e excluir | Must |
| **RF-71** | Catálogo mínimo de ferramentas: `listar_clientes`, `obter_cliente`, `acoes_hoje`, `listar_interacoes`, `metricas`, `criar_cliente`, `atualizar_cliente`, `mover_etapa`, `registrar_interacao`, `exportar_cliente`, `excluir_cliente` | Must |
| **RF-72** | Cada ferramenta declara `inputSchema` tipado e `annotations` (`readOnlyHint`, `idempotentHint`, `destructiveHint`, `openWorldHint`) para que o agente saiba o que é seguro chamar sozinho | Must |
| **RF-73** | **Nenhum `inputSchema` aceita campos de autoria** (`created_by`, `gerado_por_ia`) — a autoria vem sempre da credencial | Must |
| **RF-74** | As ferramentas chamam a **mesma camada de serviço** das rotas REST; zero lógica de domínio duplicada em `mcp/` | Must |
| **RF-75** | `metricas` devolve o mesmo payload de `GET /api/dashboard`, para o agente responder sobre desempenho sem listar todos os clientes e agregar por conta própria | Must |
| **RF-76** | Gestão de usuários **não** é exposta por MCP, de propósito: exige admin por sessão, e uma chave Bearer recebe `403`. Máquinas operam o CRM, não administram contas humanas | Must |
| **RF-77** | Erros de domínio viram erros MCP legíveis pelo agente, com a mesma mensagem da API | Must |
| **RF-78** | Ferramentas destrutivas (`excluir_cliente`) trazem o alerta de irreversibilidade na própria `description` | Must |
| **RF-79** | Documentação dedicada do MCP em `docs/MCP.md`, com exemplo de `tools/list` e `tools/call` por `curl` | Must |
| **RF-80** | Teste automatizado de paridade: toda função exportada pela camada de serviço com equivalente REST tem ferramenta MCP correspondente | Must — **novo na v2** |

### 5.11 LGPD e auditoria

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-81** | Exportar todos os dados de um cliente (ficha + interações + histórico) em JSON, por API e por MCP | Must |
| **RF-82** | Excluir permanentemente todos os dados de um cliente, em cascata | Must |
| **RF-83** | Cada registro guarda **quem criou** (`humano` \| `ia`) e **quando** | Must |
| **RF-84** | Trilha de auditoria de alterações: tabela `auditoria` com entidade, id, campo, valor anterior, valor novo, autor, credencial usada e timestamp | Must — **novo na v2** |
| **RF-85** | A trilha de auditoria é **somente leitura** pela aplicação — sem endpoint de edição ou exclusão | Must — **novo na v2** |
| **RF-86** | Política de retenção documentada para leads frios/perdidos antigos | Should |

### 5.12 Interface — segurança e sessão

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-93** | **Todo dado vindo do banco é escapado antes de entrar no DOM.** Nome de cliente, empresa, texto de interação e rótulo de chave passam por uma função de escape única antes de qualquer `innerHTML` | Must |
| **RF-94** | Resposta `401` em qualquer chamada devolve o usuário à tela de login automaticamente, com mensagem de sessão expirada | Must |
| **RF-95** | Ao sair ou expirar a sessão: **fechar o modal aberto** e limpar identidade e token CSRF da memória, antes de exibir o login | Must |
| **RF-96** | Itens de administração ocultos para quem não é admin — **conveniência de interface apenas**; a autorização real é sempre do servidor | Must |
| **RF-97** | Após salvar, a tela ativa é recarregada, para que a lista nunca fique desatualizada em relação ao banco | Must |
| **RF-98** | Alterar o próprio papel refaz a identidade em memória sem exigir novo login | Should |

> **RF-93 é a defesa que não aparece.** A v1 já faz isso corretamente com `esc()` — o que é fácil de
> perder numa reconstrução, porque nada quebra quando se esquece. O front monta HTML com
> `innerHTML` a partir de dados que **um agente de IA pode ter escrito**: um lead criado por MCP com
> `nome: "<img onerror=...>"` executa script na sua sessão de admin. Escape na saída é o que impede.

> **RF-95 tem história.** Era um bug real, corrigido em 16/08/2026: ao sair, o modal aberto — lista
> de usuários ou prefixos de chaves de API — continuava visível **sobre** a tela de login, à
> disposição de quem sentasse no navegador em seguida. Virou requisito para não voltar.

### 5.13 Operação

| ID | Requisito | Prioridade |
|---|---|---|
| **RF-99** | Rota `GET /health` **sem autenticação**, respondendo `200` com estado do processo e do banco (uma consulta trivial), e `503` se o banco não responder. Não expõe dado de negócio | Must |
| **RF-100** | `HEALTHCHECK` declarado no Dockerfile e consumido pelo orquestrador, para que o container seja reiniciado quando ficar de pé mas inutilizável | Must |
| **RF-101** | Script de **backup** do banco usando a API de backup online do SQLite (consistente com WAL, sem parar o serviço), com restauração testada e documentada | Must |
| **RF-102** | Script de **dados de exemplo** que produz uma base coerente: datas de próxima ação **relativas a hoje** (atrasadas, de hoje e futuras) e `fechado_em` preenchido nos negócios fechados | Must |

> **RF-102 corrige dois defeitos reais do `seed.js` atual.** As datas são fixas (18/05 a 08/06/2026),
> então após alguns meses tudo cai em "Atrasados" e as faixas "hoje" e "próximos" nascem vazias. E o
> `INSERT` não inclui `fechado_em` — logo, numa instalação nova, **todo negócio ganho ou perdido
> fica sem data de desfecho e os gráficos mensais do dashboard nascem vazios**, exibindo o aviso de
> "base de histórico curta" mesmo com a base populada. Dado de demonstração que não demonstra é pior
> que nenhum: leva a diagnosticar um bug que não existe.

---

## 6. Requisitos não funcionais

| ID | Requisito |
|---|---|
| **RNF-01** | **Simplicidade sob medida:** um processo, um deploy, um banco. Dependência nova só entra com justificativa escrita |
| **RNF-02** | **Segurança por padrão:** nenhuma rota de dados anônima; cabeçalhos de segurança via helmet; CSP com `script-src 'self'` **sem `'unsafe-inline'`** e sem `script-src-attr` — ver RNF-16 |
| **RNF-03** | Rate limiting em três níveis: geral na API, agressivo no login (anti brute force) e específico no endpoint MCP |
| **RNF-04** | Limite de tamanho de payload no corpo das requisições (64 KB) |
| **RNF-05** | Consultas exclusivamente por **prepared statements** — sem concatenação de SQL |
| **RNF-06** | Handler global de erros: exceção não tratada vira `500` com corpo genérico e **não derruba o processo**; a mensagem real vai para o log, nunca para o cliente |
| **RNF-07** | Nenhuma credencial em `localStorage` ou `sessionStorage`. Sessão em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção |
| **RNF-08** | Em produção: `NODE_ENV=production`, HTTPS obrigatório, HSTS ativo |
| **RNF-09** | Desempenho: p95 < 500 ms por operação, em base na ordem de milhares de clientes |
| **RNF-10** | Acessibilidade: navegação por teclado em todos os fluxos, contraste mínimo AA, `aria-label` em controles sem rótulo textual |
| **RNF-11** | Responsivo de 360 px a 1920 px, sem rolagem horizontal do corpo da página |
| **RNF-12** | Migrações de schema **aditivas e idempotentes**, executadas no boot, sem tocar em dados existentes |
| **RNF-13** | Backup: o arquivo de banco é o único estado; procedimento de backup e restauração documentado |
| **RNF-14** | Testes automatizados cobrindo camada de serviço, autenticação, paridade REST↔MCP e paridade rota↔OpenAPI |
| **RNF-15** | Comentários no código em português explicando **o porquê** das decisões não óbvias, não o que a linha faz |
| **RNF-16** | **Sem handlers inline no HTML.** Nenhum `onclick`, `ondragstart` ou `ondrop` em atributo; eventos por delegação a partir de um listener por região, usando `data-*` para identificar o alvo. É o que permite à CSP dispensar `'unsafe-inline'` |
| **RNF-17** | **Log estruturado** (JSON) com nível, timestamp e identificador de requisição; erro registra a mensagem interna, a resposta ao cliente permanece genérica. Nenhum dado pessoal ou segredo em log |
| **RNF-18** | **Container endurecido:** build multi-estágio, execução como usuário **não-root**, diretório de dados configurável por `DATA_DIR` apontando para volume persistente, nenhum segredo na imagem |
| **RNF-19** | TLS terminado no proxy reverso, com redirecionamento HTTP→HTTPS e cabeçalhos de segurança aplicados também na borda |

> **RNF-16 é dívida herdada, e é o motivo de RNF-02 hoje ser mentira.** A v1 declara CSP restritiva,
> mas a política real é `scriptSrc: ["'self'", "'unsafe-inline'"]` com `scriptSrcAttr:
> ["'unsafe-inline'"]`, porque o front usa `onclick` nos elementos gerados. Isso **anula boa parte
> da proteção contra XSS** que a CSP deveria dar — e a `SEGURANCA.md` já registra a remoção dos
> handlers inline como pendência aberta. Como a v2 reescreve o front, é o momento de pagar: sem
> handler inline, a CSP volta a valer de verdade e passa a ser a segunda linha de defesa do RF-93.

---

## 7. Arquitetura

### 7.1 Stack

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Node.js 20 LTS | Estável, disponível em qualquer host |
| HTTP | Express 4 | Já dominado, ecossistema de middlewares maduro |
| Banco | SQLite via `better-sqlite3`, modo WAL | Um arquivo, zero servidor, síncrono e rápido na escala do produto |
| Autenticação | `bcryptjs` + `crypto` nativo | Sem serviço externo, sem dependência de terceiro para login |
| Segurança | `helmet`, `express-rate-limit`, `cookie-parser` | Cabeçalhos, limites e cookies com o padrão da comunidade |
| MCP | `@modelcontextprotocol/sdk` | Implementar JSON-RPC/MCP à mão seria mais complexo e frágil |
| Documentação | Scalar (`@scalar/api-reference`), bundle local | Interface interativa sobre o OpenAPI, servida pelo próprio app |
| Validação | `zod` | Schemas das ferramentas MCP e validação de entrada |
| Front-end | HTML, CSS e JavaScript puros | Sem build, sem framework, sem etapa de compilação entre editar e ver |
| Testes | `node:test` + `supertest` | Runner nativo, sem framework adicional |
| Deploy | Docker + Traefik, TLS terminado no proxy | Já é o padrão da infraestrutura |

### 7.2 Estrutura de arquivos

```text
cpdf-crm-mentoria/
├── server.js              # Bootstrap: middlewares, rotas REST, /docs, monta /mcp, listen
├── auth.js                # Dois planos de credencial, sessões, chaves, middlewares, papéis
├── db.js                  # Conexão SQLite, schema e migrações aditivas idempotentes
├── crm-service.js         # ★ Camada de domínio compartilhada por REST e MCP
├── audit.js               # ★ NOVO: trilha de auditoria e histórico de etapas
├── openapi.yaml           # Contrato da API (OpenAPI 3.1) — validado no boot
├── mcp/
│   ├── server.mjs         # Cria o McpServer e devolve o handler Streamable HTTP
│   └── tools.mjs          # Catálogo de ferramentas: schema, annotations e run()
├── public/
│   ├── index.html         # Shell: login, topo, 4 telas, modal, toast
│   ├── styles.css         # Design System em custom properties — ver DESIGN-SYSTEM.md
│   └── app.js             # Estado, render, SVG dos gráficos, chamadas à API
├── scripts/
│   ├── reset-senha.js     # RF-90: recuperação de acesso do admin (break-glass)
│   ├── backup.js          # RF-101: backup online do SQLite, consistente com WAL
│   └── seed.js            # RF-102: base de exemplo coerente (datas relativas + fechado_em)
├── tests/
│   ├── service.test.js    # Regras de domínio
│   ├── auth.test.js       # Sessão, CSRF, chaves, papéis
│   ├── parity.test.js     # REST ↔ MCP e rotas ↔ OpenAPI
│   └── api.test.js        # Contratos HTTP ponta a ponta
├── Dockerfile             # RNF-18: multi-estágio, não-root, DATA_DIR em volume
└── docs/                  # PRD, Design System, Roadmap, Segurança, MCP, dicionário de dados
```

### 7.3 A regra arquitetural que sustenta tudo

```
        Navegador                     Agente de IA
            │                              │
      sessão + CSRF                 Bearer (chave)
            │                              │
            ▼                              ▼
      rotas /api/*                     POST /mcp
            │                              │
            └──────────┬───────────────────┘
                       ▼
                 crm-service.js
        validação · whitelist · enums · auditoria
                       │
                       ▼
                 db.js (SQLite)
```

**Nenhuma regra de negócio existe fora de `crm-service.js`.** As rotas traduzem HTTP; as ferramentas
MCP traduzem JSON-RPC. Se REST e MCP se comportarem diferente diante da mesma entrada, é bug —
e o teste de paridade (RF-80) existe para pegar isso antes do usuário.

---

## 8. Modelo de dados

### 8.1 Tabelas existentes (preservadas)

**`clientes`**

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER PK | |
| `nome` | TEXT NOT NULL | Único campo obrigatório |
| `empresa`, `cargo`, `telefone`, `email` | TEXT | |
| `tipo_cliente` | TEXT | `b2b` \| `autonomo` \| `publico` |
| `origem` | TEXT | v2: valor de lista controlada (RF-09) |
| `etapa` | TEXT NOT NULL | `novo` \| `qualificacao` \| `reuniao` \| `proposta` |
| `resultado` | TEXT NOT NULL | `em_aberto` \| `ganho` \| `perdido` |
| `valor_estimado` | REAL | |
| `proposta_enviada` | INTEGER | 0/1 |
| `status_pagamento` | TEXT | |
| `proxima_acao`, `proxima_acao_data` | TEXT | Data em `YYYY-MM-DD` |
| `fechado_em` | TEXT | Data do desfecho, derivada da transição (RF-13) |
| `created_by` | TEXT | `humano` \| `ia` — derivado da credencial |
| `created_at`, `updated_at` | TEXT | |

**`interacoes`** — `id`, `cliente_id` (FK CASCADE), `texto`, `gerado_por_ia`, `data`, `created_at`

**`usuarios`** — `id`, `nome`, `email` (UNIQUE), `senha_hash`, `papel`, `created_at`

**`sessoes`** — `token` PK, `usuario_id` (FK CASCADE), `csrf`, `expira_em`, `created_at`

**`api_keys`** — `id`, `nome`, `prefixo`, `key_hash`, `ativa`, `ultimo_uso`, `created_at`, `criada_por`

### 8.2 Tabelas novas (v2)

**`historico_etapas`** — habilita RF-29 e RF-30

```sql
CREATE TABLE IF NOT EXISTS historico_etapas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  etapa_anterior TEXT,                 -- NULL na criação do lead
  etapa_nova TEXT NOT NULL,
  resultado_anterior TEXT,
  resultado_novo TEXT,
  autor TEXT NOT NULL,                 -- humano | ia
  credencial_id INTEGER,               -- usuarios.id ou api_keys.id
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hist_cliente ON historico_etapas(cliente_id, created_at);
```

**`auditoria`** — habilita RF-84

```sql
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade TEXT NOT NULL,              -- cliente | interacao | usuario | api_key
  entidade_id INTEGER NOT NULL,
  acao TEXT NOT NULL,                  -- criar | atualizar | excluir
  campo TEXT,                          -- NULL em criar/excluir
  valor_anterior TEXT,
  valor_novo TEXT,
  autor TEXT NOT NULL,                 -- humano | ia
  credencial TEXT NOT NULL,            -- sessao | apikey
  credencial_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entidade ON auditoria(entidade, entidade_id, created_at);
```

> **Por que a auditoria não tem FK para `clientes`:** o registro precisa sobreviver à exclusão do
> cliente. Apagar o dado pessoal é direito do titular; apagar a prova de que ele foi apagado, não.
> O conteúdo gravado em `valor_anterior` deve, por isso, **omitir dados pessoais** — grava-se o nome
> do campo alterado, não o telefone antigo.

### 8.3 Migrações

Aditivas, idempotentes e executadas no boot. Cada migração verifica antes se a coluna ou tabela já
existe e registra no log o que fez. Nunca há passo manual entre `git pull` e `npm start`.

**Migração de dados da v1 para a v2:**

1. `historico_etapas` nasce vazia. Clientes existentes recebem **uma linha de abertura** com
   `etapa_anterior = NULL` e `etapa_nova` = etapa atual, `created_at = created_at` do cliente —
   uma base honesta, marcada como estimativa no dashboard enquanto o histórico for curto.
2. `origem` em texto livre é normalizada por um mapa de sinônimos (`indicação`, `Indicação`,
   `indicacao` → `indicacao`); o que não casar vira `outra` com o texto original preservado em
   `origem_livre`.

---

## 9. Contrato da API

Todas as rotas exigem autenticação (RF-48). A coluna **Credencial** indica quem pode chamar.

| Método | Rota | O que faz | Credencial |
|---|---|---|---|
| POST | `/api/auth/login` | Autentica e abre sessão | pública (rate limit agressivo) |
| POST | `/api/auth/logout` | Encerra a sessão atual | sessão |
| GET | `/api/auth/me` | Quem sou eu + token CSRF | sessão |
| PUT | `/api/auth/senha` | Troca a própria senha | sessão |
| GET | `/api/clientes` | Lista clientes | sessão \| chave |
| POST | `/api/clientes` | Cria cliente | sessão \| chave |
| GET | `/api/clientes/:id` | Ficha + interações | sessão \| chave |
| PUT | `/api/clientes/:id` | Atualiza cliente | sessão \| chave |
| PUT | `/api/clientes/:id/etapa` | Move no funil / define resultado | sessão \| chave |
| DELETE | `/api/clientes/:id` | Exclui cliente (LGPD) | sessão \| chave |
| GET | `/api/clientes/:id/export` | Exporta tudo do cliente (LGPD) | sessão \| chave |
| GET | `/api/clientes/:id/interacoes` | Lista interações | sessão \| chave |
| POST | `/api/clientes/:id/interacoes` | Adiciona anotação | sessão \| chave |
| GET | `/api/clientes/:id/historico` | **NOVO:** histórico de etapas | sessão \| chave |
| GET | `/api/hoje` | Ações atrasadas, de hoje e futuras | sessão \| chave |
| GET | `/api/dashboard` | Métricas consolidadas | sessão \| chave |
| GET | `/api/usuarios` | Lista usuários | sessão + admin |
| POST | `/api/usuarios` | Cadastra usuário | sessão + admin |
| PUT | `/api/usuarios/:id` | Edita nome/papel | sessão + admin |
| PUT | `/api/usuarios/:id/senha` | Admin redefine senha | sessão + admin |
| DELETE | `/api/usuarios/:id` | Exclui usuário | sessão + admin |
| GET | `/api/keys` | Lista chaves de API | sessão + admin |
| POST | `/api/keys` | Cria chave (segredo exibido uma vez) | sessão + admin |
| DELETE | `/api/keys/:id` | Revoga chave | sessão + admin |
| POST | `/mcp` | Endpoint MCP (JSON-RPC) | chave (Bearer) |
| GET | `/health` | **NOVO:** estado do processo e do banco (`200`/`503`) | pública |
| GET | `/docs` | Documentação interativa | pública |
| GET | `/openapi.yaml` | Spec cru | pública |

> As quatro últimas rotas ficam **fora** do `openapi.yaml` e entram na lista de exclusão do teste de
> paridade (RF-64), junto com `/docs/scalar.js` e o redirecionamento legado `/api-docs`: `/mcp` é
> JSON-RPC e tem contrato próprio em `docs/MCP.md`; `/health`, `/docs` e `/openapi.yaml` são
> infraestrutura, não API de negócio.

**Formato de erro, único em toda a API:**

```json
{ "erro": "Cliente nao encontrado" }
```

---

## 10. Interface — telas e comportamento

O detalhamento visual (cores, tipografia, espaçamento, componentes) está em
[`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md). Aqui fica o **comportamento**.

### 10.1 Login
Overlay em tela cheia. Card centralizado com marca, e-mail e senha. Erro aparece dentro do card,
sem alerta do navegador. Ao autenticar, o overlay some e o app aparece.

### 10.2 Topo
Marca à esquerda, abas ao centro (Hoje · Dashboard · Funil · Clientes), à direita o botão
**+ Novo cliente** e o menu do usuário (Usuários e Integrações apenas para admin, Trocar senha e
Sair para todos).

### 10.3 Hoje — tela de abertura
Quatro cartões de resumo, depois três blocos: **Atrasados** (vermelho), **Para fazer hoje**
(laranja) e **Próximos** (neutro). Cada item mostra nome, empresa e a próxima ação com a data.
Clique abre a ficha.

### 10.4 Dashboard
Quatro camadas na ordem **resposta rápida → detalhe**: KPIs, Evolução, Composição, Precisa de
atenção. Gráficos em SVG. Aviso no topo quando a base for pequena demais para a métrica ser
confiável.

### 10.5 Funil
Quatro colunas com contagem no cabeçalho. Cartão com nome, empresa e valor. Arrastar entre colunas
persiste na hora e mostra um toast de confirmação. A coluna sob o cursor ganha destaque.

### 10.6 Clientes
Busca no topo filtrando por nome ou empresa conforme se digita. Lista em cartões clicáveis.

### 10.7 Ficha do cliente (modal)
Três blocos: **Contato e origem** · **Negócio** (valor, proposta, status, próxima ação e data) ·
**Histórico** com botão de nova anotação. Interações de IA levam badge. Ações no rodapé: editar,
mover etapa, exportar, excluir (com confirmação explícita).

### 10.8 Estados obrigatórios
Toda lista tem estado vazio com texto humano. Toda ação tem retorno visual (toast). Toda ação
destrutiva pede confirmação. Todo erro da API vira toast de erro com a mensagem do servidor.

---

## 11. Segurança

| Camada | Controle |
|---|---|
| Transporte | HTTPS obrigatório em produção, HSTS ativo, cookies `Secure` |
| Cabeçalhos | helmet com CSP `script-src 'self'` **sem `'unsafe-inline'`** (exige RNF-16); nada de CDN |
| XSS | Escape de **toda** saída de dados no front antes do DOM (RF-93); CSP como segunda linha |
| Sessão | Cookie `httpOnly`, `SameSite=Lax`, expiração de 7 dias, revogável |
| CSRF | Token por sessão exigido em toda escrita vinda do navegador, comparado em tempo constante |
| Senhas | bcrypt com custo ≥ 12; mínimo de 8 caracteres; nunca retornadas pela API |
| Chaves de API | Somente o hash SHA-256 é guardado; segredo exibido uma vez; revogáveis; `ultimo_uso` registrado |
| Brute force | Rate limit de 10 tentativas por 15 minutos no login |
| Injeção | Prepared statements em 100% das consultas |
| Mass assignment | Whitelist explícita de campos; autoria nunca vem do corpo |
| Payload | Limite de 64 KB |
| Erros | Handler global; mensagem interna só no log |
| Autoria | Sempre derivada da credencial autenticada, nunca de entrada do cliente |

Detalhamento e modelo de ameaças em [`SEGURANCA.md`](SEGURANCA.md).

---

## 12. Privacidade e LGPD

**Dados tratados:** nome, telefone/WhatsApp, e-mail, empresa, cargo (dados pessoais); conteúdo de
conversas (pode conter informação confidencial do cliente); valores e propostas (sigilo comercial).
Clientes do setor público exigem atenção redobrada.

**Compromissos do produto:**

1. **Finalidade e minimização** — guardar apenas o necessário para a relação comercial.
2. **Acesso controlado** — nenhuma rota de dados anônima; chave de API por integração, revogável.
3. **Auditoria** — quem criou, quem alterou, quando e por qual credencial.
4. **Criptografia** — HTTPS em trânsito; backup do arquivo de banco protegido.
5. **Direitos do titular** — exportar e excluir todos os dados de um cliente, por API e por MCP.
6. **Retenção** — prazo definido para descarte de leads frios e perdidos antigos.
7. **IA com cautela** — enviar ao modelo apenas o necessário; usar provedor que não treine com os
   dados; deixar registrado no histórico o que foi gerado por IA.

---

## 13. Plano de construção

| Fase | Entrega | Pronto quando |
|---|---|---|
| **F0 — Fundação** | `db.js` com schema completo (incluindo tabelas novas), migrações, `crm-service.js` com todas as regras, testes de domínio | `npm test` verde na camada de serviço |
| **F1 — Autenticação** | `auth.js` completo, bootstrap do admin, sessões, CSRF, chaves, papéis, testes | Login funciona, CSRF bloqueia escrita sem token, papéis respeitados |
| **F2 — API REST** | Todas as rotas de `crm-service` e `auth` expostas, handler global de erros | Toda rota da seção 9 responde com o contrato certo |
| **F3 — OpenAPI + /docs** | `openapi.yaml` completo, validação no boot, Scalar local em `/docs`, teste de paridade rota↔spec | `/docs` navega e testa; teste de paridade verde |
| **F4 — MCP** | `mcp/server.mjs` e `mcp/tools.mjs`, Bearer obrigatório, 11 ferramentas, teste de paridade REST↔MCP | `tools/list` autenticado responde; sem chave, `401` |
| **F5 — Front-end** | Login, topo, Hoje, Funil, Clientes, ficha, modais | Fluxo completo utilizável, estados vazios cobertos |
| **F6 — Dashboard** | Quatro camadas, gráficos SVG, conversão e tempo por etapa | Números batem com consulta manual ao banco |
| **F7 — Endurecimento** | helmet com CSP sem `'unsafe-inline'`, rate limits, revisão de segurança, LGPD, README e docs | Revisão de segurança sem achado alto ou crítico |
| **F8 — Operação** | `/health`, `HEALTHCHECK` no container, log estruturado, backup com restauração testada, `seed` coerente | Restauração de backup validada em ambiente limpo |

Cada fase termina com commit próprio, mensagem descritiva e documentação atualizada. Documentação
desatualizada é considerada **defeito**, não pendência.

---

## 14. Critérios de aceite

O produto está pronto quando **todos** os itens abaixo passam:

**Funcional**
- [ ] Cadastrar, listar, buscar, editar e excluir cliente funciona pela interface e pela API
- [ ] Arrastar cartão no funil persiste e gera linha em `historico_etapas`
- [ ] Fechar negócio carimba `fechado_em`; reabrir limpa; corrigir ganho↔perdido mantém a data
- [ ] Tela Hoje classifica corretamente atrasados, hoje e próximos
- [ ] Dashboard mostra as quatro camadas, incluindo conversão e tempo por etapa
- [ ] Admin cadastra usuário, redefine senha e tem os bloqueios de último admin funcionando
- [ ] Chave de API é exibida uma vez, funciona no `Bearer` e para de funcionar ao ser revogada

**API e documentação**
- [ ] `/docs` abre, navega e permite testar com `Authorize`
- [ ] `/openapi.yaml` é OpenAPI 3.1 válido e cobre 100% das rotas
- [ ] Teste de paridade rota ↔ spec passa
- [ ] Servidor recusa subir com spec inválido

**MCP**
- [ ] `POST /mcp` sem `Authorization` retorna `401`
- [ ] `POST /mcp` com chave revogada retorna `401`
- [ ] `tools/list` autenticado lista as 11 ferramentas com `inputSchema` e `annotations`
- [ ] `criar_cliente` via MCP grava `created_by = 'ia'`
- [ ] Nenhum `inputSchema` aceita campo de autoria
- [ ] Teste de paridade REST ↔ MCP passa

**Validação de entrada**
- [ ] `tipo_cliente` fora do enum retorna `400` (não grava silenciosamente)
- [ ] `etapa` e `resultado` inválidos retornam `400` **em criar, atualizar e mover**
- [ ] E-mail em formato inválido retorna `400`
- [ ] `proxima_acao_data` fora de `YYYY-MM-DD` retorna `400`

**Segurança**
- [ ] Nenhuma rota de dados responde sem credencial
- [ ] Escrita por sessão sem `X-CSRF-Token` recebe `403`
- [ ] Nenhuma credencial aparece em `localStorage`
- [ ] Payload acima de 64 KB é rejeitado
- [ ] 11 tentativas de login em 15 minutos são bloqueadas
- [ ] Erro não tratado retorna `500` genérico sem derrubar o processo
- [ ] Um lead com `nome` contendo HTML é renderizado como **texto**, não executado
- [ ] A CSP em produção não contém `'unsafe-inline'` em `script-src` nem `script-src-attr`
- [ ] Nenhum atributo `onclick`/`ondragstart`/`ondrop` no HTML gerado
- [ ] Sair com um modal aberto leva ao login **sem** o conteúdo do modal visível

**Operação**
- [ ] `GET /health` responde `200` com o banco no ar e `503` com o banco indisponível
- [ ] Container é reiniciado pelo orquestrador quando o healthcheck falha
- [ ] Processo roda como usuário não-root e persiste em volume via `DATA_DIR`
- [ ] Backup roda com o serviço no ar e a restauração foi testada em ambiente limpo
- [ ] Script de exemplo gera follow-ups atrasados, de hoje **e** futuros
- [ ] Após o script de exemplo, os gráficos mensais do dashboard mostram dados
- [ ] Script de recuperação redefine a senha do admin e derruba as sessões dele

**LGPD**
- [ ] Exportar cliente devolve ficha, interações e histórico
- [ ] Excluir cliente apaga em cascata e preserva a linha de auditoria
- [ ] Toda escrita registra autor e credencial

**Qualidade**
- [ ] `npm test` verde
- [ ] Sem rolagem horizontal de 360 px a 1920 px
- [ ] Fluxos principais navegáveis por teclado
- [ ] README, `DESIGN-SYSTEM.md`, `MCP.md` e `ROADMAP.md` refletem o código

---

## 15. Riscos e decisões em aberto

| Risco | Impacto | Mitigação |
|---|---|---|
| Histórico de etapas curto no início | Conversão e tempo por etapa sem base estatística | Avisar na tela até haver 3 meses de dados reais |
| Peso das etapas é chute inicial | Pipeline ponderado otimista ou pessimista | Revisar os pesos com a taxa real após 6 meses de histórico |
| Agente de IA excluir cliente por engano | Perda de dados | `destructiveHint`, alerta na descrição da ferramenta e trilha de auditoria |
| SQLite em arquivo único | Perda total em falha de disco | Backup automatizado e restauração testada |
| Chave de API vazada | Acesso total à base por máquina | Uma chave por integração, revogação individual, `ultimo_uso` monitorado |
| Conteúdo escrito por agente renderizado sem escape | XSS na sessão do admin, com acesso total | RF-93 (escape na saída) + RNF-16/RNF-02 (CSP sem `'unsafe-inline'`) — duas camadas independentes |
| Migração para OpenAPI 3.1 quebrar geradores de client | Integração de terceiro parando | Migrar em F3, com o teste de paridade (RF-64) verde antes de publicar |

**Decisões conscientemente adiadas:** permissões granulares por campo, multi-tenant, versionamento
da API (`/v1`) — só quando houver um segundo consumidor externo estável.

---

## 16. Documentos relacionados

| Documento | Conteúdo |
|---|---|
| [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) | Tokens, tipografia, cores, componentes, acessibilidade |
| [`ROADMAP.md`](ROADMAP.md) | WhatsApp, handoff, resumos de IA, campanhas e além |
| [`SEGURANCA.md`](SEGURANCA.md) | Modelo de ameaças e controles aplicados |
| [`MCP.md`](MCP.md) | Catálogo de ferramentas e guia de conexão de agentes |
| [`DICIONARIO-DADOS-LEADS.md`](DICIONARIO-DADOS-LEADS.md) | Significado de cada campo e como as métricas derivam dele |
| [`ESTIMATIVA-DESENVOLVIMENTO.md`](ESTIMATIVA-DESENVOLVIMENTO.md) | Esforço e cronograma |
