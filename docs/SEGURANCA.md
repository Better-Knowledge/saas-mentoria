# Avaliação de Segurança — Mini CRM

> Data: 31/05/2026 · Escopo: `server.js`, `db.js`, `public/app.js` · Tipo: revisão de código (white-box)
> Classificação de severidade: 🔴 Crítico · 🟠 Alto · 🟡 Médio · 🔵 Baixo

## Resumo executivo

O CRM funciona, mas **não está pronto para dados reais de clientes**. O modelo de autenticação atual
é a maior fragilidade: existe **um único token compartilhado** entre você (UI) e as automações de IA, e
**os dados podem ser lidos sem token nenhum**. Para uma ferramenta que guarda dados pessoais (LGPD),
isso precisa ser corrigido antes de ir ao ar. A boa notícia: a base de dados é sólida (sem SQL injection,
sem mass assignment) — o trabalho concentra-se em **autenticação, autorização e proteção de transporte**.

---

## Achados

### 🔴 1. Endpoints de leitura sem autenticação (exposição de dados pessoais)
Todos os `GET` — incluindo **`/api/clientes/:id/export`** — não exigem token. Qualquer pessoa que
alcance o servidor lê **nome, telefone, e-mail, valores e todo o histórico** de todos os clientes.
- **Impacto:** vazamento de dados pessoais. Violação direta da LGPD (acesso não autorizado).
- **Onde:** `server.js` — rotas `GET /api/clientes`, `/api/clientes/:id`, `/api/hoje`, `/interacoes`, `/export` (sem `auth`).
- **Correção:** proteger **todos** os endpoints atrás de autenticação, sem exceção.

### 🔴 2. Não há autenticação de usuário (só credencial de máquina) — *o ponto que você percebeu*
Não existem contas, login, senha ou sessão. O "token" é uma chave de máquina, não a identidade de uma
pessoa. Por isso ele é pedido até para o usuário comum na tela — o que está errado conceitualmente.
- **Impacto:** impossível saber **quem** fez cada ação; sem controle de acesso por pessoa; UX ruim.
- **Correção:** separar em dois planos (ver "Recomendação central" abaixo).

### 🔴 3. Token único compartilhado entre UI e IA
O mesmo segredo (`API_TOKEN`) serve para o navegador e para as automações.
- **Impacto:** se vazar (localStorage, XSS, histórico, .env de uma integração), dá **acesso total**;
  e não há como revogar **uma** integração sem derrubar todas.
- **Onde:** `server.js:9,21-36` e `app.js` (`getToken()` em localStorage).

### 🟠 4. Modo "sem token = liberado"
Se `API_TOKEN` estiver vazio, toda escrita é aceita como "humano".
- **Impacto:** subir em produção sem definir o token deixa a aplicação **aberta para escrita**.
- **Onde:** `server.js:26-30`. **Correção:** falhar a inicialização se o segredo não estiver configurado.

### 🟠 5. Trilha de auditoria falsificável
Quem é "humano" ou "ia" é decidido pelo header `X-Origem`, controlado pelo cliente.
- **Impacto:** auditoria (`created_by`, `gerado_por_ia`) sem valor — qualquer um se passa por outro.
- **Onde:** `server.js:24`. **Correção:** derivar a identidade do **tipo de credencial autenticada**, não de um header.

### 🟠 6. Token no `localStorage`
A credencial fica acessível a qualquer JavaScript da página.
- **Impacto:** um XSS rouba o token. **Correção:** sessão de usuário em cookie `httpOnly` + `Secure` +
  `SameSite`; chave de API **nunca** no navegador.

### 🟠 7. Sem HTTPS/TLS
Token e dados pessoais trafegam em texto puro.
- **Correção:** TLS obrigatório em produção; redirecionar HTTP→HTTPS; ativar HSTS.

### 🟡 8. Sem cabeçalhos de segurança
Faltam CSP (mitiga XSS), `X-Frame-Options` (clickjacking), HSTS, `X-Content-Type-Options`.
- **Correção:** adicionar `helmet` com CSP.

### 🟡 9. Sem rate limiting / proteção a força bruta
Token pode ser tentado infinitamente; endpoints podem ser abusados (DoS).
- **Correção:** `express-rate-limit` (especialmente no login/auth).

### 🟡 10. Comparação de token não constante no tempo
`token !== API_TOKEN` é vulnerável (teoricamente) a *timing attack*.
- **Correção:** `crypto.timingSafeEqual`.

### 🟡 11. Validação de entrada incompleta
E-mail/telefone não são validados; texto de interação sem limite de tamanho.
- **Correção:** validar formato (e-mail), limitar tamanho dos campos, manter `express.json({ limit })`.

### 🔵 12. Sem handler global de erros
Uma exceção não tratada pode derrubar o processo.
- **Correção:** middleware de erro + processo gerenciado (PM2/systemd/container com restart).

### 🔵 13. Higiene de segredos
O `.env` de teste usa token fraco (`teste-token-123`). Trocar por segredo forte; nunca versionar (já está no `.gitignore`).

### 🔵 14. Retenção de dados (LGPD)
Não há expurgo automático de leads frios/perdidos. Definir política de retenção e rotina de exclusão.

---

## O que já está bom ✅
- **Sem SQL injection:** 100% *prepared statements* (`better-sqlite3`).
- **Sem mass assignment:** `montaCliente()` faz *whitelist* de campos.
- **Validação de enums** (etapa/resultado).
- **XSS:** uso consistente de `esc()` na renderização do frontend.
- **Segredo fora do código** (`.env` + `.gitignore`).
- **Direitos LGPD** já previstos (export/delete) — falta apenas protegê-los.

---

## Recomendação central — arquitetura de autenticação

Separar **pessoas** de **máquinas**:

**A) Usuários (UI) — autenticação de sessão**
- Login com e-mail + senha; senha com hash forte (**bcrypt** ou **argon2id**).
- Sessão em cookie `httpOnly` + `Secure` + `SameSite=Lax`, com proteção **CSRF**.
- Papéis/perfis (admin, assistente) para o multiusuário futuro.
- Alternativa pronta: Auth0, Clerk, Supabase Auth ou login Google (OAuth).

**B) Automações/IA — chaves de API próprias**
- Uma **API key por integração**, com escopo e **revogação independentes**.
- Enviadas como `Authorization: Bearer`, **nunca** a mesma credencial do usuário, **nunca** no navegador.

**Transversal**
- **Proteger todos os endpoints** (inclusive leitura e export).
- **Autorização** por identidade real (`user_id`/`api_key_id`) → auditoria confiável.
- **HTTPS** + `helmet` + **rate limiting** obrigatórios.

> **Prioridade de correção:** 1 → 2 → 3 → 4 → 7 (transporte) → demais.

---

## Correções aplicadas (31/05/2026)

Implementada a arquitetura de autenticação em dois planos e o *hardening*:

| Achado | Status | O que foi feito |
|---|---|---|
| 1 — Leitura/export sem auth | ✅ Corrigido | `requireAuth` em **todos** os endpoints `/api`, inclusive `/export`. |
| 2 — Sem autenticação de usuário | ✅ Corrigido | Login e-mail+senha (hash **bcrypt**), sessão em **cookie httpOnly**, papéis admin/assistente. |
| 3 — Token único compartilhado | ✅ Corrigido | **API keys** próprias por integração, revogáveis; só o hash é guardado; chave mostrada uma vez. |
| 4 — "Sem token = liberado" | ✅ Corrigido | Não há mais bypass; sem credencial válida → 401. |
| 5 — Auditoria falsificável | ✅ Corrigido | Autor derivado da **credencial real** (sessão→humano, API key→ia), não de header. |
| 6 — Token no localStorage | ✅ Corrigido | Nada sensível no navegador; sessão em cookie httpOnly; só o CSRF em memória. |
| 7 — Sem HTTPS | ⚙️ Pronto p/ produção | Cookies `Secure` + HSTS quando `NODE_ENV=production` (exige TLS no deploy). |
| 8 — Cabeçalhos | ✅ Corrigido | `helmet` com CSP. |
| 9 — Rate limiting | ✅ Corrigido | `express-rate-limit` geral + limite estrito no `/api/auth/login`. |
| 10 — Comparação de token | ✅ Corrigido | `crypto.timingSafeEqual` (CSRF e chaves via hash). |
| 11 — Validação de payload | ✅ Parcial | `express.json({ limit })` + limite de tamanho do texto de interação. |
| 12 — Handler de erros | ✅ Corrigido | Middleware global de erro (não derruba o processo). |

**Verificação (testes executados):** leitura sem auth → 401; export sem auth → 401; senha
errada → 401; login correto → cookie+CSRF; escrita sem CSRF → 403; escrita com CSRF → 201
(autor=humano); criação/uso de API key → 201 (autor=ia); revogação → 200; chave revogada → 401.

**Pendências recomendadas (próximos passos):** TLS no deploy; remover handlers `onclick` inline
para endurecer a CSP (tirar `'unsafe-inline'` de script); política formal de retenção LGPD.

---

## Acesso MCP (servidor de agentes) — revisão de segurança 06/06/2026

> Escopo: `POST /mcp`, `mcp/server.mjs`, `mcp/tools.mjs`, `crm-service.js`, middleware `requireBearer`
> em `auth.js`. Revisão exigida pela constituição (Princípios II e IV) antes de tocar dados reais —
> reforçada porque o MCP expõe operações **destrutivas** (excluir/exportar) a agentes remotos.

### Princípio II — Segurança e Privacidade por padrão

| Verificação | Resultado |
|---|---|
| Toda requisição ao `/mcp` exige Bearer válido; sem modo anônimo | ✅ `requireBearer` → `401` sem/ inválida/ revogada (testado) |
| Rate limiting no `/mcp` (anti força bruta de chave) | ✅ `mcpLimiter` 600/15min por IP (`trust proxy`) |
| Cabeçalhos de segurança | ✅ `helmet` global cobre `/mcp` |
| Transporte criptografado em produção | ✅ TLS na borda (Traefik HTTP→HTTPS + HSTS); processo/porta inalterados |
| Validação de entrada, sem escrita parcial | ✅ schema (zod) + regras de domínio (enums, `nome`, texto ≤5000); payload ≤64 KB (testado) |
| Sem SQL injection | ✅ 100% prepared statements em `crm-service.js`; sem SQL por concatenação |
| Segredo da chave | ✅ guardado só como `sha256`; mostrado uma vez; comparações em tempo constante (inalterado) |
| Credencial de máquina fora do navegador | ✅ MCP usa Bearer; nada sensível no `localStorage` |

### Princípio IV — Auditoria confiável e autenticada

| Verificação | Resultado |
|---|---|
| Autoria derivada da credencial, não da entrada | ✅ `created_by="ia"` mesmo enviando `"humano"` no corpo (testado); schema descarta o campo e o serviço força o autor |
| Registro de quem e quando | ✅ `created_by`/`gerado_por_ia` + `ultimo_uso` da chave atualizado a cada chamada |
| Revogação isolada e imediata | ✅ revogar uma chave → `401` na seguinte; outras chaves intactas (testado) |

### Observações e decisões

- **CSRF não se aplica ao MCP**: a proteção CSRF é do plano de sessão (cookie). Chaves Bearer não
  carregam cookie ambiente → corretamente fora do CSRF, igual à API REST por chave.
- **Operações destrutivas (excluir/exportar)** ficam expostas por decisão de produto (FR-013): são
  autenticadas, auditadas, sob rate limit e marcadas com `destructiveHint`. **Contenção:** revogação
  imediata da credencial.
- **Isolamento entre credenciais**: o servidor MCP é stateless — cada requisição cria um `McpServer`
  próprio ligado ao principal daquela chamada; não há estado mutável compartilhado entre credenciais.
- **zod descarta campos desconhecidos** por padrão → reforço extra contra falsificação de autoria.

**Conclusão:** sem achados críticos. O acesso MCP está alinhado aos Princípios II e IV e pronto para
produção atrás do Traefik (TLS). Pendência herdada: política formal de retenção LGPD (igual à API).

---

## Multiusuário (cadastro pela interface) — revisão de segurança 16/08/2026

> Escopo: rotas `/api/usuarios*` e `PUT /api/auth/senha` em `server.js`, funções de gestão em
> `auth.js`, telas **Usuários** e **Trocar minha senha** em `public/app.js`.
> Fecha o item deixado em aberto na recomendação central: *"papéis/perfis (admin, assistente)
> para o multiusuário futuro"*.

### Modelo adotado

Carteira **compartilhada** (todos veem os mesmos leads) com dois papéis: **admin** administra
usuários e chaves de API; **assistente** usa o CRM inteiro mas não administra acessos.

| Verificação | Resultado |
|---|---|
| Toda rota de usuários exige admin **via sessão** | ✅ `requireAuth` + `requireAdmin`; assistente e Bearer key → `403` (testado) |
| Escritas protegidas contra CSRF | ✅ `csrfProtect` em POST/PUT/DELETE; sem header → `403` (testado) |
| Hash da senha nunca sai da API | ✅ todos os `SELECT` de usuário listam colunas explícitas, sem `senha_hash` |
| Senha nova passa por bcrypt | ✅ mesmo `hashSenha` (custo 12) do login |
| Política mínima de senha | ✅ 8 caracteres, validado no servidor (a interface só antecipa a mensagem) |
| Troca da própria senha exige a senha atual | ✅ `403` com a senha errada (testado) |
| Redefinição por admin derruba as sessões do alvo | ✅ `DELETE FROM sessoes WHERE usuario_id` → sessão anterior vira `401` (testado) |
| Troca da própria senha derruba as **outras** sessões | ✅ mantém só o token em uso — se a senha vazou, o invasor cai (testado) |
| Exclusão de usuário encerra o acesso na hora | ✅ sessões caem por `ON DELETE CASCADE` |
| Mudança de papel vale imediatamente | ✅ `obterSessao` faz JOIN em `usuarios` a cada requisição; rebaixado perde `/api/usuarios` sem relogin (testado) |
| Sem SQL injection | ✅ prepared statements em todas as consultas novas |
| Escalada de privilégio pela interface | ✅ esconder itens do menu é só conveniência; a autorização é sempre do servidor (testado com sessão de assistente) |

### Proteções contra "tiro no pé"

- Recusa **excluir a própria conta**.
- Recusa **excluir ou rebaixar o último administrador** — o sistema nunca fica sem quem administre.
- E-mail é normalizado (minúsculas, sem espaços) e é `UNIQUE` no schema; duplicata → `409`.

### Observações e decisões

- **Senha inicial definida pelo admin** (decisão de produto), combinada fora da ferramenta. Não há
  envio de e-mail nem link de convite — não existe SMTP no projeto. A pessoa troca depois em
  **Trocar minha senha**.
- **Sem troca obrigatória no primeiro login**: avaliado e adiado; exigiria coluna de controle e um
  passo extra no fluxo. Enquanto isso, a senha inicial é conhecida pelo admin — trate-a como
  provisória.
- **Rate limiting do login** continua o mesmo (10/15min por IP) e agora protege todas as contas.
- **Corrigido no caminho:** ao sair (ou a sessão expirar), o modal aberto permanecia visível sobre
  a tela de login — deixando a lista de usuários ou os prefixos de chaves à mostra para quem
  usasse o navegador em seguida. `mostrarLogin()` passou a fechar o modal e limpar `USUARIO`/`CSRF`
  da memória. O bug era anterior a esta mudança (afetava a tela de Integrações).
- **Pendência:** excluir um usuário **não** revoga as chaves de API que ele criou (`criada_por`
  vira `NULL` por `ON DELETE SET NULL`). É intencional — a chave pertence à integração, não à
  pessoa — mas exige revogação manual em **Integrações** no desligamento de alguém.

**Conclusão:** sem achados críticos. A autorização é consistentemente do lado do servidor e as
proteções de sessão acompanham as mudanças de senha e de papel.

---

## Resumo automático de reunião — revisão de segurança 23/08/2026

Feature `002-resumo-reuniao-ia`. Esta é a primeira funcionalidade do produto que **sai para a
rede** e que **guarda dado pessoal de terceiros**. Os três pontos abaixo são decisões tomadas
com consciência do custo, não descuidos.

### Correção de uma regressão que quase entramos

O plano original desta feature mandava estender `resolverPrincipal` para também ler o cookie de
sessão. Isso teria aberto um vazamento entre os dois planos de credencial: `requireBearer`
valida apenas o **prefixo** do header antes de chamar a função, então uma requisição com
`Authorization: Bearer <lixo>` acompanhada de um cookie de sessão válido cairia no fallback e
entraria em `POST /mcp` como principal humano — credencial de pessoa operando o plano de
máquina, num endpoint que não exige CSRF.

**Correção aplicada:** `auth.js` agora tem `resolverBearer` e `resolverSessao` separadas.
`requireBearer` usa só a primeira; `resolverPrincipal` (rotas `/api`, onde os dois planos são
legítimos) escolhe entre elas e **não faz fallback** — um Bearer inválido devolve `null`, nunca
cai para a sessão. `tests/resumo-api.test.js` fixa a fronteira com quatro casos de regressão.

### 1. Segredo do provedor de IA

- `ANTHROPIC_API_KEY` é lida de `process.env` dentro de `ia/extrator.js` e não sai de lá: não é
  devolvida em resposta, não vai para log, não entra em mensagem de erro.
- O SDK só é carregado quando há chave (`require` tardio) — sem ela o produto sobe normalmente
  e apenas a feature aparece indisponível.
- A imagem Docker não carrega o segredo; ele vem do ambiente.

### 2. Minimização antes do envio — e o limite honesto dela

`mascarar()` substitui e-mails, telefones brasileiros, CPF e CNPJ antes de a transcrição sair da
máquina. O modelo recebe a transcrição e mais nada: nenhum dado do cadastro é anexado.

**O que essa técnica não faz, e que ninguém deve supor que faça:** mascaramento por padrão
textual não pega tudo. Um telefone ditado por extenso ("meu número é onze, nove oito...") passa
inteiro. Um endereço passa. Um nome próprio passa — e passa de propósito, porque sem nome o
resumo perde a utilidade. É **redução de exposição, não garantia**, e `tests/extrator.test.js`
tem um caso que fixa esse limite por escrito em vez de fingir que ele não existe.

Uma sequência de 11 dígitos sem pontuação é ambígua entre celular e CPF; a regra adotada rotula
como telefone. Os dois são mascarados de qualquer forma — o rótulo é que difere.

### 3. Injeção de prompt

A transcrição é conteúdo hostil por definição: qualquer pessoa numa reunião pode ditar uma
instrução. Quatro defesas simultâneas:

1. a transcrição **nunca** entra no `system`; vai delimitada numa mensagem `user`, precedida da
   instrução de que o conteúdo delimitado é dado a analisar, jamais instrução a seguir;
2. **nenhuma ferramenta é declarada** na chamada — não há nada para uma instrução injetada
   sequestrar: o modelo não lê arquivo, não busca na web, não escreve no banco;
3. **saída estruturada** — o formato é imposto pelo schema, não pelo texto;
4. **escape na renderização** — a saída passa por `esc()` antes de qualquer `innerHTML`.

**O que continua possível:** nenhuma dessas defesas impede o modelo de ser *convencido* a
escrever uma decisão falsa no resumo. O que impede é a pessoa lendo antes de salvar. O corpus de
referência tem um caso de injeção (`05-injecao.txt`) exatamente para medir isso.

**E no plano de máquina essa defesa não existe.** Uma chave de API pode confirmar sem revisão —
decisão do responsável pelo produto, registrada na spec. O controle compensatório é que o
registro entra marcado como `revisao: sem_revisao`, visível na ficha e na trilha. Continua
valendo, nos dois planos, que confirmar **não altera campo de negócio** do cliente: um erro de
leitura do modelo não vira proposta errada sem ação humana explícita.

### 4. Retenção de 90 dias — e a tensão que ela cria

Decisão do responsável pelo produto: a transcrição é guardada por 90 dias e **não** entra na
exportação de dados do titular.

**A tensão, dita com todas as letras:** a transcrição contém falas do **próprio titular**, além
de terceiros. Mantê-la 90 dias e excluí-la da exportação significa que, nesse período, existe
dado do titular no sistema que a exportação não entrega. As duas alternativas coerentes seriam
não reter a transcrição (minimização máxima) ou incluí-la na exportação (rastreabilidade
máxima). A decisão registrada é a primeira, e está aqui para ser revista, não para ser
esquecida.

O que **está** garantido: exclusão do cliente apaga a transcrição em cascata, antes do prazo;
a purga roda no boot, a cada 24 h e por `npm run purgar`; e o registro revisado sobrevive ao
descarte da fonte, com a interface dizendo que a fonte expirou em vez de mostrar erro.

### 5. Trilha de auditoria

A tabela `auditoria` (PRD RF-84) foi criada por esta feature, com o schema do PRD §8.2 — a
fundação v2 a herda em vez de recriá-la. `audit.js` **recusa** gravar conteúdo de transcrição,
de resumo ou de campo de contato: uma lista de campos sensíveis vira `[omitido]`. A trilha não
tem FK para `clientes`, de propósito: ela sobrevive à exclusão do titular, porque apagar o dado
pessoal é direito dele e apagar a prova de que ele foi apagado não é.

### CSP fechada — a pendência foi paga (convergência, 23/08/2026)

A CSP do produto declarava uma proteção contra XSS que **não tinha**: `script-src` carregava
`'unsafe-inline'` e havia `script-src-attr: 'unsafe-inline'`, porque o front da v1 usava 21
`onclick` mais cinco handlers de arraste em atributo. Enquanto isso valeu, o escape de saída era
a única linha de defesa real.

**Corrigido.** Todos os handlers inline foram substituídos por delegação — um dispatcher de
clique para o app, um para o modal de resumo, e os eventos de arraste delegados no container do
kanban, com o alvo identificado por `data-*`. A política agora servida é:

```
script-src 'self'; script-src-attr 'none'
```

Verificado com o app rodando: ficha, funil com arraste ponta a ponta, gestão de usuários e
chaves de API funcionam sob a política fechada, com o console limpo. `tests/csp.test.js` trava
os dois lados — o cabeçalho e a ausência de handler em atributo — para que a diretiva não
reabra em silêncio.

Um efeito colateral bom: o botão que copiava a chave de API embutia o **segredo em texto dentro
do atributo `onclick`**, legível por qualquer script ou extensão que lesse o documento. Agora a
chave revelada vive só numa variável em memória, e é limpa quando a sessão termina.

**Ressalva honesta:** remover o `Object.assign(window, {...})` não tirou as funções do objeto
global — em script clássico, toda `function` de topo já é propriedade de `window` por definição
da linguagem. O que sumiu foi a re-exportação explícita. Tirar de fato exigiria envolver o
arquivo num módulo ou IIFE, o que é refatoração de fundação.
