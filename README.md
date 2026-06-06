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
- **Funil** — quadro Kanban; arraste os cartões entre as 4 etapas.
- **Clientes** — lista com busca; clique para abrir a ficha completa.
- **Integrações** (menu do usuário, só admin) — crie/revogue chaves de API para a IA.

## Autenticação (dois planos)

**Pessoas (interface):** login com e-mail + senha. A sessão fica em um **cookie httpOnly**
(o navegador envia sozinho); as escritas exigem um **token CSRF**. Senhas são guardadas com
hash **bcrypt**. Nenhuma credencial fica no `localStorage`.

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

## Servidor MCP (agentes de IA remotos)

Além da API REST, o CRM expõe um **servidor MCP** (Model Context Protocol) em `POST /mcp`
(transporte *Streamable HTTP*) para que agentes de IA operem o CRM remotamente. **Tudo é
autenticado**: a mesma **chave de API** (header `Authorization: Bearer`) emitida na tela
**Integrações** — sem credencial válida, `401`. As ações de escrita ficam marcadas como
**geradas por IA** (derivado da credencial).

São **10 ferramentas** com paridade total à API: `listar_clientes`, `obter_cliente`, `acoes_hoje`,
`listar_interacoes`, `criar_cliente`, `atualizar_cliente`, `mover_etapa`, `registrar_interacao`,
`exportar_cliente`, `excluir_cliente`. Detalhes em [docs/MCP.md](docs/MCP.md).

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

Node.js + Express · SQLite (`better-sqlite3`) · bcryptjs · helmet · `@modelcontextprotocol/sdk` (servidor MCP) · HTML/CSS/JS puro.
