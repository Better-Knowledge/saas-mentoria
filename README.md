# Mini CRM — Consultoria & IA Generativa

CRM simples e sob medida para centralizar clientes, acompanhar o funil de vendas e nunca
esquecer um follow-up. Pensado para uso individual + integração com agentes de IA via API.

📄 Documentos: [PRD](docs/PRD.md) · [Avaliação de Segurança](docs/SEGURANCA.md) · [Estimativa de Desenvolvimento](docs/ESTIMATIVA-DESENVOLVIMENTO.md)

## Como rodar

1. Instale as dependências:
   ```powershell
   npm install
   ```
2. Crie seu `.env` a partir do exemplo e **defina uma senha forte** para o admin:
   ```powershell
   Copy-Item .env.example .env
   ```
   Edite `.env` (`ADMIN_EMAIL`, `ADMIN_SENHA`).
3. (Opcional) Popule com dados de exemplo:
   ```powershell
   node seed.js
   ```
4. Inicie o servidor:
   ```powershell
   npm start
   ```
5. Abra <http://localhost:3000> e faça **login** com o e-mail/senha do admin.

> No primeiro start, se não houver usuários, o admin é criado a partir do `.env`
> (ou `admin@crm.local` / `mudar123` com um aviso, caso você não defina).

## Telas

- **Hoje** — o que está atrasado e o que fazer hoje (suas próximas ações).
- **Dashboard** — os números do negócio, em quatro camadas (veja abaixo).
- **Funil** — quadro Kanban; arraste os cartões entre as 4 etapas.
- **Clientes** — lista com busca; clique para abrir a ficha completa.
- **Usuários** (menu do usuário, só admin) — cadastre e gerencie quem acessa o CRM.
- **Integrações** (menu do usuário, só admin) — crie/revogue chaves de API para a IA.
- **Trocar minha senha** (menu do usuário, todos) — autoatendimento de senha.

## Dashboard

Organizado da resposta rápida para o detalhe, em vez de um mural de gráficos:

1. **KPIs** — pipeline em aberto, **pipeline ponderado**, taxa de vitória e ticket médio.
2. **Evolução** — ganhos × perdidos por mês, receita ganha acumulada, novos leads por mês e
   a proporção de cadastros feitos por IA e por pessoas.
3. **Composição** — valor parado em cada etapa do funil, origem dos leads e tipo de cliente.
4. **Precisa de atenção** — leads sem próxima ação agendada, parados há mais de 30 dias e
   propostas enviadas ainda em aberto. Clique em qualquer um para abrir a ficha.

O **pipeline ponderado** multiplica o valor de cada negócio pelo peso da etapa
(`novo` 10% · `qualificação` 25% · `reunião` 50% · `proposta` 75%), definido em
[`crm-service.js`](crm-service.js) — ajuste conforme a sua taxa real de conversão. É a diferença
entre somar desejos e ter uma previsão: um lead recém-chegado de R$ 90 mil não vale R$ 90 mil.

A **origem** é medida por valor **ganho**, não por volume de leads: três indicações que fecham
valem mais que vinte cliques que não fecham.

Os gráficos são SVG gerado no próprio `app.js` — sem biblioteca, sem peso extra e sem afrouxar a CSP.

### O campo `fechado_em`

Medir ganhos e perdas por mês exige saber **quando** o negócio fechou. O `updated_at` não serve —
ele muda a cada edição, então corrigir um telefone jogaria a venda para outro mês. Por isso existe
`clientes.fechado_em`, preenchido pela transição de `resultado`: fechar carimba a data de hoje,
reabrir volta a `null`, e corrigir `ganho` ↔ `perdido` mantém a data original.

A migração é automática no start. Negócios que já estavam fechados antes da coluna existir
receberam `date(updated_at)` como **estimativa** — o dashboard avisa isso na tela enquanto o
histórico for curto. Detalhes em [docs/DICIONARIO-DADOS-LEADS.md](docs/DICIONARIO-DADOS-LEADS.md).

### O que ficou de fora, e por quê

**Taxa de conversão entre etapas** e **tempo médio por etapa** exigiriam histórico de mudanças de
etapa; o schema guarda só a etapa *atual*. Dá para saber quantos leads **estão** em cada etapa,
nunca quantos **passaram** por elas. Precisaria de uma tabela de histórico.

A **origem** é texto livre: `indicação` e `Indicação` viram duas barras diferentes. Se o gráfico
começar a se fragmentar, vale transformar o campo numa lista fechada com opção "outra".

## Autenticação (dois planos)

**Pessoas (interface):** login com e-mail + senha. A sessão fica em um **cookie httpOnly**
(o navegador envia sozinho); as escritas exigem um **token CSRF**. Senhas são guardadas com
hash **bcrypt**. Nenhuma credencial fica no `localStorage`.

## Usuários e papéis

O CRM é **multiusuário**. O primeiro admin nasce do `.env`; os demais são cadastrados na tela
**Usuários** (menu do usuário → Usuários), sem precisar mexer em arquivo ou script.

| Papel | Usa o CRM (leads, funil, interações) | Gerencia usuários e chaves de API |
|---|---|---|
| **admin** | sim | sim |
| **assistente** | sim | não |

- **Carteira compartilhada:** todos enxergam os mesmos leads. Cada registro continua guardando
  **quem criou** — humano ou IA — para auditoria.
- **Senha inicial:** o admin define e combina com a pessoa, que pode trocá-la depois em
  **Trocar minha senha**. Mínimo de 8 caracteres.
- **Perdeu o acesso?** O admin redefine a senha em **Usuários → Editar**; todas as sessões
  daquela pessoa caem na hora.
- **Trocar a própria senha** encerra as *outras* sessões da conta e mantém a atual.
- **Proteções:** o sistema recusa excluir a própria conta e recusa excluir ou rebaixar o
  **último administrador** — não dá para ficar sem quem administre.
- Mudanças de papel valem **na hora**, sem novo login: o papel é lido do banco a cada requisição.

Excluir um usuário derruba as sessões dele, mas **não** apaga os leads que cadastrou nem revoga
as chaves de API que criou — revogue-as em **Integrações** se for o caso.

**Máquinas (IA/automações):** **chaves de API** próprias, uma por integração, **revogáveis**,
enviadas no header `Authorization: Bearer`. Crie-as na tela **Integrações** — a chave é
mostrada **uma única vez**.

## API para IA / automações

Todos os endpoints exigem autenticação. Para automações, use uma chave de API:

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/clientes` | Lista clientes |
| POST | `/api/clientes` | Cria cliente |
| GET | `/api/clientes/:id` | Cliente + interações |
| PUT | `/api/clientes/:id` | Atualiza cliente |
| PUT | `/api/clientes/:id/etapa` | Move no funil (`{ "etapa": "proposta" }`) |
| DELETE | `/api/clientes/:id` | Exclui cliente (LGPD) |
| GET | `/api/clientes/:id/export` | Exporta tudo do cliente (LGPD) |
| GET/POST | `/api/clientes/:id/interacoes` | Lista / adiciona anotação |
| GET | `/api/hoje` | Ações de hoje, atrasadas e futuras |
| GET | `/api/dashboard` | Métricas consolidadas (KPIs, séries mensais, composição) |

Exemplo (a IA criando um lead que chegou pelo WhatsApp):
```powershell
curl -X POST http://localhost:3000/api/clientes `
  -H "Authorization: Bearer SUA_CHAVE_DE_API" `
  -H "Content-Type: application/json" `
  -d '{"nome":"Maria Souza","empresa":"ACME","origem":"WhatsApp","etapa":"novo"}'
```
Registros criados por chave de API são marcados como **gerados por IA** (auditoria confiável,
derivada da credencial — não de um header).

> A lógica de negócio (validação, whitelist, auditoria) vive em [`crm-service.js`](crm-service.js),
> compartilhada pela API REST **e** pelo servidor MCP, para que os dois caminhos se comportem igual.

## Documentação da API

Documentação interativa em **[`/docs`](http://localhost:3000/docs)**, gerada com **Scalar** a partir
do [`openapi.yaml`](openapi.yaml) (OpenAPI 3.0.3). O spec cru fica em `/openapi.yaml`.

Dá para testar as rotas pela própria página: o botão **Authorize** já vem apontando para a chave
de API (`bearerAuth`), o caminho das automações.

Duas decisões que valem conhecer antes de mexer:

- **O bundle do Scalar é servido pelo próprio app** (`/docs/scalar.js`, a partir do `node_modules`),
  nunca de CDN. A CSP permite só `'self'` em `script-src`, e afrouxá-la para uma página de
  documentação não se justificaria.
- **As fontes remotas do Scalar ficam desligadas** (`withDefaultFonts: false`); a página usa a mesma
  Inter do app. O Scalar também tenta consultar o catálogo de APIs públicas dele em
  `api.scalar.com` — a CSP bloqueia, e deve continuar bloqueando. Isso gera dois erros no console
  da página; **não libere `connect-src` para silenciá-los**.

O caminho antigo `/api-docs` (Swagger UI) redireciona para `/docs` com `301`.

## Servidor MCP (agentes de IA remotos)

Além da API REST, o CRM expõe um **servidor MCP** (Model Context Protocol) em `POST /mcp`
(transporte *Streamable HTTP*) para que agentes de IA operem o CRM remotamente. **Tudo é
autenticado**: a mesma **chave de API** (header `Authorization: Bearer`) emitida na tela
**Integrações** — sem credencial válida, `401`. As ações de escrita ficam marcadas como
**geradas por IA** (derivado da credencial).

São **11 ferramentas** com paridade total à API: `listar_clientes`, `obter_cliente`, `acoes_hoje`,
`listar_interacoes`, `metricas`, `criar_cliente`, `atualizar_cliente`, `mover_etapa`,
`registrar_interacao`, `exportar_cliente`, `excluir_cliente`. Detalhes em [docs/MCP.md](docs/MCP.md).

`metricas` devolve o mesmo payload de `GET /api/dashboard`, para o agente responder sobre
desempenho e previsão sem listar todos os clientes e agregar por conta própria. Gestão de
usuários **não** é exposta por MCP, de propósito: exige admin via sessão, e uma chave Bearer
recebe `403` — máquinas operam o CRM, não administram contas humanas.

```bash
# descobrir as ferramentas disponíveis
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer SUA_CHAVE_DE_API" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Privacidade (LGPD)

- Dados sensíveis: contato pessoal, conteúdo de conversas, valores/propostas.
- Todos os endpoints (inclusive **leitura** e **export**) ficam atrás de autenticação.
- Cada registro guarda **quem criou** (humano ou IA) e **quando** (auditoria).
- Endpoints de **exportar** e **excluir** dados de um cliente.
- Chaves de API **revogáveis** individualmente.
- Em produção: defina `NODE_ENV=production`, sirva por **HTTPS** (cookies `Secure` + HSTS) e
  faça backup do arquivo `crm.db`.

## Segurança aplicada

helmet (CSP + cabeçalhos), rate limiting (geral + anti brute force no login), CSRF nas escritas
de sessão, hashing bcrypt, comparação de token em tempo constante, validação de tamanho de payload,
prepared statements (sem SQL injection) e handler global de erros. Detalhes em [docs/SEGURANCA.md](docs/SEGURANCA.md).

## Stack

Node.js + Express · SQLite (`better-sqlite3`) · bcryptjs · helmet · `@modelcontextprotocol/sdk` (servidor MCP) ·
`@scalar/api-reference` (documentação em `/docs`) · HTML/CSS/JS puro.
