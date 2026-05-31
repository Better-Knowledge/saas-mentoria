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
