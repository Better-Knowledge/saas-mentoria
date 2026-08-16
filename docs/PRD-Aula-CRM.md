# PRD da Aula — Mini CRM em 3 horas

> **Formato:** dois blocos de 1h30, codando ao vivo, com 1h30 de intervalo
> **Versão:** 1.0 · 16/08/2026
> **PRD completo:** [`PRD-Reconstrucao-CRM.md`](PRD-Reconstrucao-CRM.md) — este documento é um recorte dele
> **Design System:** [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) — entregue pronto, não é conteúdo da aula

---

## A promessa da aula

> Ao final, você terá um CRM funcionando **e** um agente de IA operando esse CRM — pelo mesmo
> código de regra de negócio que a interface usa.

Não é um tutorial de CRUD. O CRM é o pretexto; o assunto é **construir software que agentes operam
sem virar dois sistemas paralelos**.

## O arco narrativo

```
       MANHÃ (1h30)                    TARDE (1h30)
   Software para pessoas    ────►   Software para máquinas

   schema → serviço → auth          contrato → MCP → agente
        → rotas → tela                    operando

   termina com: CRM usável          termina com: Claude usando o CRM
```

A pergunta plantada na manhã — *"por que a regra de negócio não fica dentro da rota?"* — só é
respondida na tarde, quando o MCP reaproveita o mesmo arquivo sem escrever uma linha de lógica.
**Esse é o momento da aula.** Tudo antes existe para prepará-lo.

---

## Os quatro compromissos

São as decisões que precisam entrar desde o primeiro commit porque colocá-las depois custa caro.
Escreva-as no quadro antes de abrir o editor e volte a elas a cada bloco.

| # | Compromisso | Por que agora e não depois |
|---|---|---|
| **1** | Toda regra de negócio vive em `crm-service.js` | Colocar depois significa duplicar a lógica no MCP ou refatorar tudo |
| **2** | Autoria vem da credencial, nunca do corpo da requisição | Um cliente pode mentir sobre quem é; uma credencial autenticada, não |
| **3** | Autenticação desde a primeira rota | Retrofitar auth toca toda rota e todo `fetch` do front |
| **4** | Nenhuma rota de dados anônima — nem leitura | "Depois eu protejo" é como nasce vazamento |

---

## Kit inicial (entregue pronto)

Estes arquivos **não** são construídos ao vivo. São insumo, não conteúdo — digitar CSS não ensina
arquitetura, e são ~25 minutos que valem mais no MCP.

| Arquivo | O que é |
|---|---|
| `package.json` | Dependências já declaradas |
| `.env.example` | `ADMIN_EMAIL`, `ADMIN_SENHA`, `PORT` |
| `public/styles.css` | O Design System inteiro — 442 linhas de tokens e componentes |
| `public/index.html` | Estrutura das telas, sem comportamento |
| `seed.js` | Dados de exemplo, para a primeira tela nascer povoada |
| `.claude/launch.json` | Configuração de preview — permite ver a aplicação sem sair do editor |

> A turma abre a aula com `npm install && node seed.js`. Quando a primeira tela renderizar, ela já
> tem 15 clientes e parece um produto — não um formulário vazio.

> ### ⚠️ Corrigir o `seed.js` antes da aula
>
> O `seed.js` do repositório tem **datas fixas** (18/05 a 08/06/2026). Rodado hoje, joga **tudo** em
> "Atrasados" e deixa "Para fazer hoje" e "Próximos" vazios — justamente na tela de abertura, que é
> o momento de maior impacto. Ele também **não preenche `fechado_em`**, então os negócios fechados
> nascem sem data de desfecho.
>
> Antes da aula, troque as datas por valores **relativos a hoje** (alguns dias atrás, hoje, alguns
> dias à frente) e inclua `fechado_em` no `INSERT`. São dois ajustes pequenos que decidem se a
> primeira tela vende a ideia ou não.

---

## Escopo

### Entra

Cadastro de clientes · funil Kanban com arrastar-e-soltar · histórico de interações · próxima ação
com data · tela Hoje · login com sessão e CSRF · API REST protegida · OpenAPI com `/docs`
interativo · servidor MCP autenticado com 5 ferramentas · um agente real operando o CRM.

### Fica de fora (e por quê)

| Cortado | Motivo |
|---|---|
| **Dashboard** | ~326 linhas entre SQL e SVG. Muito volume, pouca arquitetura — é o corte de melhor custo-benefício |
| **Multiusuário e papéis** | Um admin criado do `.env` já exercita todo o mecanismo de sessão |
| **Tela de Integrações** | A chave de API sai de um script CLI de 15 linhas; a tela não ensina nada novo |
| **Exportar cliente (LGPD)** | 5 linhas — fica como exercício, com o código no repositório |
| **`origem` como lista controlada** | Fica texto livre **de propósito** — vira o fechamento da aula |
| **Histórico de mudanças de etapa** | Idem: a ausência dele é o argumento final |

Os dois últimos são deliberados. A aula termina mostrando **os defeitos que o sistema já tem** e
apontando para o [PRD de reconstrução](PRD-Reconstrucao-CRM.md), em vez de fingir que o resultado
de 3 horas é definitivo.

---

# BLOCO 1 — Manhã · Software para pessoas

**Meta:** terminar com um CRM em que dá para logar, cadastrar cliente, arrastar cartão no funil e
ver o que fazer hoje.

## B1.1 — Schema (`db.js`) · ~15 min

| ID | Requisito |
|---|---|
| **RF-01** | Cliente com nome (obrigatório), empresa, cargo, telefone, e-mail, tipo (`b2b`/`autonomo`/`publico`) e origem |
| **RF-07** | Valor estimado, proposta enviada (0/1) e status de pagamento |
| **RF-08** | Próxima ação (texto) e data da próxima ação (`YYYY-MM-DD`) |
| **RF-83** | Toda linha guarda `created_by` (`humano` \| `ia`) e timestamps |
| **RNF-12** | Migrações aditivas e idempotentes rodando no boot |

Quatro tabelas: `clientes`, `interacoes`, `usuarios`, `sessoes`. WAL ligado, `foreign_keys = ON`.

> **⏸ Pare e explique — compromisso 2.** A coluna `created_by` existe desde a primeira linha do
> schema. Quando o MCP chegar à tarde, ela já está lá esperando. Pergunte à turma: *"quem preenche
> esse campo?"* — e guarde a resposta para o bloco 2.

**Pronto quando:** `node -e "require('./db')"` cria o `crm.db` sem erro e `node seed.js` popula.

## B1.2 — Regras de negócio (`crm-service.js`) · ~25 min

O arquivo mais importante da aula.

| ID | Requisito |
|---|---|
| **RF-02** | Listar clientes por última movimentação, com contagem de interações |
| **RF-04** | Obter ficha completa: cliente + interações |
| **RF-05** | Criar e atualizar por **whitelist explícita** de campos — sem mass assignment |
| **RF-06** | Excluir cliente, apagando interações em cascata |
| **RF-12** | Resultado do negócio: `em_aberto` \| `ganho` \| `perdido` |
| **RF-13** | `fechado_em` derivado da **transição** de resultado: fechar carimba hoje, reabrir limpa, corrigir ganho↔perdido mantém a data |
| **RF-15** | Etapa e resultado inválidos → erro de domínio `400` |
| **RF-16** | Registrar interação (≤ 5000 caracteres) |
| **RF-20** | Classificar em atrasados (< hoje), hoje (= hoje) e próximos (> hoje) |
| **RF-51** | Escrita recebe `autor` como **parâmetro**, nunca lê autoria do corpo |
| **RF-52** | Erro de negócio é `ErroDominio` com status HTTP — nunca `500` genérico |

> **⏸ Pare e explique — compromisso 1.** Nenhuma linha deste arquivo sabe o que é HTTP. Sem `req`,
> sem `res`, sem status code espalhado. Faça a pergunta em voz alta: *"por que não escrever isso
> direto na rota, que seria mais rápido?"* — e diga que a resposta vem depois do almoço.

> **⏸ Pare e explique — `fechado_em`.** Por que não usar `updated_at` para medir o mês do
> fechamento? Porque corrigir um telefone em setembro jogaria uma venda de agosto para setembro. A
> data do desfecho precisa vir da **transição de estado**, não da última edição.

**Pronto quando:** um script solto cria cliente, move etapa, fecha negócio e a data de `fechado_em`
se comporta nos três casos.

## B1.3 — Autenticação (`auth.js`) · ~20 min

| ID | Requisito |
|---|---|
| **RF-33** | Primeiro admin criado no boot a partir do `.env`, se não houver usuário |
| **RF-42** | Senha com hash bcrypt (custo 12), mínimo de 8 caracteres, nunca retornada |
| **RF-49** | Sessão em cookie `httpOnly` + `SameSite=Lax` + `Secure` em produção |
| **RF-50** | Escrita por sessão exige `X-CSRF-Token`, comparado em **tempo constante** |
| **RF-48** | `requireAuth` como middleware — sem credencial, `401` |

> **⏸ Pare e explique — CSRF.** Por que a proteção CSRF só se aplica a quem vem por sessão? Porque
> o navegador envia cookie sozinho; um `Authorization: Bearer` não. Quem não usa cookie não é alvo
> de CSRF. Essa distinção volta à tarde, quando o MCP entrar sem CSRF nenhum.

**Pronto quando:** `POST /api/auth/login` devolve cookie + token CSRF, e qualquer outra rota sem
cookie devolve `401`.

## B1.4 — Rotas (`server.js`) · ~15 min

| ID | Requisito |
|---|---|
| **RF-53** | Rotas: clientes (CRUD), `/etapa`, interações (listar/criar), `/hoje` |
| **RF-51** | `autorDe(req)` deriva o autor da credencial e passa ao serviço |
| **RNF-02** | helmet com CSP restritiva; `script-src 'self'` |
| **RNF-03** | Rate limit geral na API e agressivo no login |
| **RNF-04** | Limite de 64 KB no corpo |
| **RNF-06** | Handler global de erros — traduz `ErroDominio` e não derruba o processo |

> **Observe o tamanho das rotas.** Cada uma tem uma ou duas linhas: valida credencial, chama o
> serviço, devolve JSON. Se uma rota começar a crescer, a lógica está no lugar errado.

**Pronto quando:** o `curl` autenticado percorre todas as rotas com o contrato certo.

## B1.5 — Interface (`public/app.js`) · ~15 min

| ID | Requisito |
|---|---|
| **RF-03** | Busca por nome ou empresa, filtrando conforme se digita |
| **RF-10** | Kanban de 4 etapas: `novo` → `qualificacao` → `reuniao` → `proposta` |
| **RF-11** | Arrastar cartão entre colunas persiste na hora |
| **RF-21** | Cartões de resumo com a contagem de cada faixa |
| **RF-22** | Clicar em qualquer item abre a ficha |
| **RF-23** | Estado vazio com texto humano — nunca lista em branco |
| **RF-18** | Interação gerada por IA leva `.badge-ia` |
| **RF-93** | **Todo dado do banco passa por `esc()` antes de entrar no `innerHTML`** |
| **RF-94** | Resposta `401` devolve o usuário à tela de login automaticamente |
| **RF-97** | Após salvar, a tela ativa é recarregada — a lista nunca fica desatualizada |

O `styles.css` já está pronto: a tela nasce com a identidade final. O trabalho aqui é estado,
render e `fetch` — com o token CSRF em toda escrita.

> **⏸ Pare e explique — XSS em três linhas.** Escreva a função `esc()` **antes** do primeiro
> `innerHTML`, não depois. Depois faça a pergunta: *"de onde vem o nome desse cliente?"* Do banco.
> E quem escreve no banco? À tarde, **um agente de IA**. Um lead criado por MCP com
> `nome: "<img src=x onerror=alert(1)>"` executa script na sessão do admin. São três linhas que
> ninguém vê funcionando — e é exatamente por isso que somem numa reconstrução.
>
> ```js
> function esc(s) {
>   return (s || '').replace(/[&<>"]/g, c => (
>     { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
>   ));
> }
> ```

> **⏸ Nota sobre o badge.** O `.badge-ia` está no CSS mas ainda não aparece na tela, porque nada
> escreve como IA. Diga isso em voz alta — é o gancho para a tarde.

**Pronto quando — e este é o marco do almoço:** login funciona, cliente é cadastrado, cartão
arrasta entre colunas e a tela Hoje mostra atrasados e ações do dia.

### Roteiro do bloco 1

| Minuto | O quê |
|---|---|
| 00–10 | Problema, os quatro compromissos, `npm install`, tour do kit inicial |
| 10–25 | `db.js` |
| 25–50 | `crm-service.js` |
| 50–70 | `auth.js` |
| 70–80 | `server.js` |
| 80–90 | `app.js` + primeira demonstração completa |

> **Folga:** o roteiro fecha em 80 minutos de conteúdo. Os 10 restantes são para o que sempre
> acontece.

> **Plano B — se atrasar:** corte a busca (RF-03) e o formulário de edição. O que **não** pode cair
> é o Kanban com arrastar-e-soltar: é a demonstração que sustenta o almoço.

---

# BLOCO 2 — Tarde · Software para máquinas

**Meta:** terminar com um agente de IA operando o CRM que a turma acabou de construir.

## B2.0 — Retomada · ~10 min

Reabra a pergunta da manhã: *"por que a regra não ficou dentro da rota?"* Deixe a turma responder.
Depois mostre o desenho:

```
      Navegador                  Agente de IA
          │                           │
    sessão + CSRF              Bearer (chave)
          │                           │
          ▼                           ▼
     rotas /api/*                 POST /mcp
          │                           │
          └────────────┬──────────────┘
                       ▼
                 crm-service.js
```

> **⏸ O momento da aula.** Se a lógica estivesse dentro das rotas, o caminho da direita exigiria
> reescrever tudo — ou aceitar que os dois caminhos se comportem diferente. **Interface dupla só
> funciona com núcleo único.**

## B2.1 — Contrato da API (`openapi.yaml` + `/docs`) · ~25 min

| ID | Requisito |
|---|---|
| **RF-54** | `openapi.yaml` versionado no repositório, cobrindo as rotas construídas |
| **RF-55** | Cada operação com `operationId`, `summary`, parâmetros, corpo e respostas |
| **RF-56** | Schemas reutilizáveis em `components/schemas`: `Lead`, `NovoLead`, `Interacao`, `Erro` |
| **RF-57** | Dois `securitySchemes`: `bearerAuth` e `cookieAuth` |
| **RF-59** | Documentação interativa em `/docs` |
| **RF-60** | Bundle servido **localmente**, nunca de CDN |
| **RF-62** | Spec cru acessível em `/openapi.yaml` |
| **RF-63** | Spec validado no boot — servidor não sobe com OpenAPI inválido |

Documente **cinco rotas**, não todas. O padrão se repete; o resto é digitação.

> **⏸ Pare e explique — por que não CDN.** Servir o bundle de um CDN exigiria liberar um domínio de
> terceiro em `script-src`. Afrouxar a política de segurança do app inteiro para deixar uma página
> de documentação mais fácil de servir é uma troca ruim. O bundle sai do `node_modules` e é servido
> pelo próprio app.

> **⏸ Pare e explique — a dívida que a aula assume.** Aproveite para mostrar a CSP no `server.js`:
> ela tem `'unsafe-inline'` em `script-src` e `script-src-attr`, porque o front usa `onclick` nos
> elementos gerados. Ou seja: **a CSP do sistema que acabamos de construir não protege contra XSS
> como parece.** Quem protege, hoje, é o `esc()` da manhã. A correção — delegação de eventos com
> `data-*` — está em RNF-16 do [PRD de Reconstrução](PRD-Reconstrucao-CRM.md) e ficaria cara em 3
> horas. Declarar a dívida em voz alta vale mais do que fingir que ela não existe.

> **⏸ Por que isso importa para agentes.** Um OpenAPI bem escrito é o que permite a uma automação
> descobrir sua API sem ler seu código. Documentação aqui não é cortesia — é interface.

**Pronto quando:** `/docs` abre, o botão **Authorize** aparece e dá para disparar uma rota real pela
própria página.

## B2.2 — Chaves de API · ~10 min

| ID | Requisito |
|---|---|
| **RF-43** | Chave nomeada por integração, segredo exibido **uma única vez** |
| **RF-44** | Somente o hash SHA-256 é guardado — nunca o segredo |
| **RF-45** | Revogação individual |
| **RF-46** | `ultimo_uso` registrado a cada validação |
| **RF-49** | `requireAuth` passa a aceitar `Authorization: Bearer` além da sessão |

Sem tela: **crie ao vivo** um `nova-chave.js` de ~15 linhas que gera a chave e imprime no terminal.
Ele não existe no repositório — mas o [`reset-senha.js`](../reset-senha.js), que existe, é o molde
exato: `require('./db')`, uma consulta preparada, um `console.log`. Vale mostrar o arquivo antes de
escrever o novo; a turma vê que "script de manutenção" já é um padrão do projeto.

> **⏸ Pare e explique.** Guardar só o hash significa que **nem você** consegue recuperar a chave de
> alguém. Isso é recurso, não limitação: um vazamento do banco não entrega credencial utilizável.

**Pronto quando:** `curl -H "Authorization: Bearer <chave>" .../api/clientes` responde, e após a
revogação responde `401`.

## B2.3 — Servidor MCP · ~30 min

| ID | Requisito |
|---|---|
| **RF-66** | Servidor MCP em `POST /mcp`, transporte Streamable HTTP, no mesmo processo |
| **RF-67** | Bearer obrigatório — sem credencial, `401`. **Nunca anônimo** |
| **RF-68** | Reaproveita as chaves de API já emitidas; sem credencial paralela |
| **RF-70** | Ferramentas mapeiam operações que a API já expõe |
| **RF-72** | Cada ferramenta declara `inputSchema` e `annotations` (`readOnlyHint`, `destructiveHint`) |
| **RF-73** | **Nenhum `inputSchema` aceita campo de autoria** |
| **RF-74** | As ferramentas chamam `crm-service.js` — zero lógica de domínio em `mcp/` |
| **RF-77** | Erro de domínio vira erro MCP com a mesma mensagem da API |

**Cinco ferramentas**, escolhidas para contar a história inteira:

| Ferramenta | Ensina |
|---|---|
| `listar_clientes` | O formato mais simples: sem entrada, `readOnlyHint` |
| `obter_cliente` | `inputSchema` tipado com validação |
| `acoes_hoje` | Que o agente enxerga o mesmo "hoje" que a pessoa |
| `criar_cliente` | Escrita com autoria derivada da credencial |
| `registrar_interacao` | O `.badge-ia` finalmente aparecendo na tela |

> **⏸ Pare e explique — a pergunta da manhã, respondida.** Abra `tools.mjs` e mostre que cada `run`
> tem uma linha: chama o serviço. Nenhuma validação reescrita, nenhum enum duplicado. Se amanhã a
> regra de `fechado_em` mudar, ela muda **em um lugar** e os dois caminhos acompanham.

> **⏸ Pare e explique — compromisso 2, fechado.** Mostre que nenhum `inputSchema` tem `created_by`.
> Um agente **não consegue** mentir sobre quem escreveu, porque o campo não existe na porta de
> entrada. Auditoria que depende da boa vontade de quem chama não é auditoria.

**Pronto quando:** `tools/list` com chave válida lista as 5 ferramentas; sem `Authorization`,
`401`.

## B2.4 — O agente operando · ~10 min

O pagamento de tudo. Conecte um agente real e peça, em português:

1. *"O que eu preciso fazer hoje?"* → `acoes_hoje`
2. *"Chegou um lead pelo WhatsApp: Maria Souza, da ACME, quer um diagnóstico de automação"* →
   `criar_cliente`
3. *"Registra que liguei para ela e ficou de mandar o orçamento na sexta"* → `registrar_interacao`

Volte ao navegador e recarregue. **O lead está lá. O `.badge-ia` apareceu.** O badge que estava no
CSS desde a manhã, sem nunca aparecer, agora tem quem o produza.

## B2.5 — Fechamento · ~5 min

Termine mostrando o que o sistema **já deve**:

| Defeito | Consequência hoje |
|---|---|
| `origem` é texto livre | `indicação` e `Indicação` viram duas categorias em qualquer relatório |
| `tipo_cliente` não é validado | O enum está no código e na documentação, mas qualquer string é gravada |
| `etapa` inválida cai em silêncio para `novo` | O agente recebe `201` e acredita que funcionou |
| `proxima_acao_data` sem validação | Data em outro formato **some** da tela Hoje sem erro nenhum |
| CSP com `'unsafe-inline'` | A política existe, mas não protege contra XSS — o `esc()` está sozinho |
| Sem histórico de etapa | Dá para saber quantos leads **estão** em cada etapa, nunca quantos **passaram** |
| Sem testes automatizados | Toda verificação é manual, e isso para de escalar na primeira integração |
| Sem `/health` e sem backup | Em produção, o container pode ficar de pé servindo erro — e não há plano de recuperação |

> **O melhor exercício de fechamento:** peça que apontem qual desses defeitos é o **mais perigoso**.
> A resposta não é a CSP nem a falta de testes — é a data sem validação, porque falha **em
> silêncio** exatamente no mecanismo que dá nome ao produto (anti-esquecimento). Bug que grita se
> conserta; bug que sussurra fica anos.

Aponte para o [PRD de reconstrução](PRD-Reconstrucao-CRM.md) e para o [Roadmap](ROADMAP.md).

> **A lição final:** software bom não é o que não tem dívida — é o que **sabe qual dívida tem e por
> quê**. Três horas produziram um sistema funcionando e uma lista honesta do que falta. As duas
> coisas são entrega.

### Roteiro do bloco 2

| Minuto | O quê |
|---|---|
| 00–10 | Retomada e o desenho da interface dupla |
| 10–35 | `openapi.yaml` + `/docs` |
| 35–45 | Chaves de API + `nova-chave.js` |
| 45–75 | `mcp/server.mjs` + `mcp/tools.mjs` |
| 75–85 | Agente operando ao vivo |
| 85–90 | Fechamento e dívidas |

> **Plano B — se atrasar:** corte o OpenAPI para **duas** rotas documentadas e vá direto ao `/docs`.
> Se apertar muito, sacrifique o bloco B2.1 inteiro e mantenha o MCP: sem o agente operando, a aula
> perde o desfecho. **A demonstração de B2.4 é inegociável.**

---

## Divergências em relação ao repositório

Declare estas diferenças na abertura — a turma vai comparar com o código final e precisa saber o
que esperar.

| Item | Na aula | No repositório |
|---|---|---|
| Dashboard | ausente | 4 camadas com gráficos SVG |
| Usuários | um admin do `.env` | multiusuário com papéis `admin` / `assistente` |
| Chaves de API | script CLI | tela Integrações |
| Ferramentas MCP | 5 | 11, com paridade total |
| OpenAPI | 5 rotas | cobertura completa |
| LGPD | excluir apenas | exportar e excluir |
| Recuperação de acesso | ausente | `reset-senha.js` |
| `origem`, `tipo_cliente`, datas | sem validação | sem validação (**mesmos defeitos**, corrigidos no PRD v2) |
| CSP | com `'unsafe-inline'` | com `'unsafe-inline'` (**mesma dívida**, corrigida no PRD v2) |

**A forma é idêntica.** Mesma arquitetura, mesmos quatro compromissos, mesmo `crm-service.js` no
centro. O que muda é a quantidade de superfície — e é por isso que o repositório serve como
continuação natural do que a turma construiu, e não como outro projeto.

---

## Checklist do instrutor

**Véspera**
- [ ] Kit inicial em repositório clonável, com `npm install` já testado na máquina da aula
- [ ] **`seed.js` corrigido**: datas relativas a hoje e `fechado_em` preenchido
- [ ] `node seed.js` rodado e conferido na tela — "Atrasados", "Para hoje" e "Próximos" todos com item
- [ ] Agente configurado e testado contra uma instância local do CRM pronto
- [ ] Repositório final acessível, para quem quiser conferir durante a aula
- [ ] Os quatro compromissos escritos onde a turma veja o tempo todo

**Durante**
- [ ] Marco do almoço atingido: login + Kanban arrastando
- [ ] Todas as pausas **⏸** feitas — são a aula, o código é o pretexto
- [ ] `esc()` escrito **antes** do primeiro `innerHTML`, não depois
- [ ] Pergunta da manhã explicitamente reaberta em B2.0
- [ ] Agente operando ao vivo antes dos 85 minutos do bloco 2

**Depois**
- [ ] PRD completo, Design System e Roadmap compartilhados
- [ ] Exercícios propostos: exportar cliente (LGPD) · uma sexta ferramenta MCP (`mover_etapa`) ·
      `origem` como lista controlada · validar `tipo_cliente` e `proxima_acao_data`
