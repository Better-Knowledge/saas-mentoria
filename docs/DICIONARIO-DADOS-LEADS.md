# Dicionário de Dados — Cadastro de Leads via API

> Data: 06/06/2026 · Escopo: `POST /api/clientes` (criar lead/negócio) · Fonte: `server.js`, `db.js`
> Um "lead" neste CRM é um registro da tabela **`clientes`** (contato + negócio + funil).

## Como chamar

| Item | Valor |
|---|---|
| **Método / Rota** | `POST /api/clientes` |
| **Base URL** | `https://mentoria.crm.better-knowledge.com` |
| **Autenticação** | `Authorization: Bearer <API_KEY>` (automação/IA) **ou** sessão de navegador (cookie + header `X-CSRF-Token`) |
| **Content-Type** | `application/json` |
| **Tamanho máx. do corpo** | 64 KB |
| **Rate limit** | 600 requisições / 15 min por IP (em `/api`) |
| **Resposta de sucesso** | `201 Created` com o lead completo em JSON (inclui `id`, `created_by`, `created_at`, `updated_at`) |

> A `API_KEY` é gerada por um **admin** (tela de API Keys / `POST /api/keys`) e exibida **uma única vez**.
> Requisições com Bearer key gravam o lead como `created_by = "ia"`; via sessão, como `created_by = "humano"`.

---

## Campos de entrada (corpo JSON)

| Campo | Tipo | Obrigatório | Default | Valores válidos | Observações |
|---|---|:---:|---|---|---|
| `nome` | string | **Sim** | — | texto livre | **Único campo obrigatório.** Espaços nas pontas são removidos; vazio → `400`. |
| `empresa` | string | Não | `null` | texto livre | — |
| `cargo` | string | Não | `null` | texto livre | — |
| `telefone` | string | Não | `null` | texto livre | Sem validação de formato. Recomendado E.164 (`+5511999998888`). |
| `email` | string | Não | `null` | texto livre | Sem validação de formato — valide antes de enviar. |
| `tipo_cliente` | string | Não | `"b2b"` | `b2b` · `autonomo` · `publico` | ⚠️ O servidor **não** valida: qualquer string é gravada. Use os valores da convenção para os relatórios baterem. |
| `origem` | string | Não | `null` | texto livre | Canal de entrada do lead. Ex.: `WhatsApp`, `Instagram`, `Indicação`, `Site`. |
| `etapa` | string | Não | `"novo"` | `novo` · `qualificacao` · `reuniao` · `proposta` | Etapa do funil. Valor fora da lista cai **silenciosamente** em `"novo"`. |
| `resultado` | string | Não | `"em_aberto"` | `em_aberto` · `ganho` · `perdido` | Valor fora da lista cai **silenciosamente** em `"em_aberto"`. Para lead novo, deixe `em_aberto`. |
| `valor_estimado` | número | Não | `0` | ≥ 0 (aceita decimal) | Valor do negócio em R$. Strings numéricas (`"1500"`) são convertidas; valor não numérico vira `0`. |
| `proposta_enviada` | booleano | Não | `false` | `true` / `false` (ou `1` / `0`) | Qualquer valor "truthy" vira `1`; caso contrário `0`. |
| `status_pagamento` | string | Não | `null` | texto livre | Ex.: `aguardando`, `pago`, `parcial`. |
| `proxima_acao` | string | Não | `null` | texto livre | Descrição do follow-up. Ex.: `Enviar proposta`. |
| `proxima_acao_data` | string (data) | Não | `null` | **`YYYY-MM-DD`** | ⚠️ A tela "Hoje" compara como texto neste formato; outro formato (ex.: `06/06/2026`) quebra a classificação atrasado/hoje/futuro. |

### Campos definidos pelo servidor (não envie — são ignorados ou derivados)

| Campo | Origem |
|---|---|
| `id` | Autoincremento. |
| `created_by` | Derivado da credencial (`ia` para API key, `humano` para sessão). Mesmo que você envie no corpo, é **ignorado**. |
| `created_at` / `updated_at` | Timestamp automático (hora local do servidor). |
| `fechado_em` | Data (`YYYY-MM-DD`) em que o negócio saiu de `em_aberto`, derivada da **transição** de `resultado`. Enviar no corpo é ignorado. |

#### Como o `fechado_em` se comporta

| Transição de `resultado` | O que acontece com `fechado_em` |
|---|---|
| `em_aberto` → `ganho` ou `perdido` | recebe a data de hoje |
| `ganho` ou `perdido` → `em_aberto` | volta a `null` (negócio reaberto) |
| `ganho` ↔ `perdido` | **mantém** a data original — só o desfecho foi corrigido |
| lead já criado como `ganho`/`perdido` | nasce com a data de hoje |

Vale tanto para `PUT /api/clientes/:id` quanto para `PUT /api/clientes/:id/etapa` (e para as
ferramentas MCP equivalentes). É o campo que sustenta os gráficos mensais do **Dashboard** —
`updated_at` não serviria, porque muda a cada edição do cadastro.

---

## Exemplos

### Mínimo (só o obrigatório)

```json
{ "nome": "Maria Silva" }
```

### Completo (lead qualificado com follow-up agendado)

```json
{
  "nome": "Maria Silva",
  "empresa": "Acme Consultoria",
  "cargo": "Diretora de Operações",
  "telefone": "+5511999998888",
  "email": "maria@acme.com.br",
  "tipo_cliente": "b2b",
  "origem": "Instagram",
  "etapa": "qualificacao",
  "resultado": "em_aberto",
  "valor_estimado": 12000,
  "proposta_enviada": false,
  "status_pagamento": "aguardando",
  "proxima_acao": "Enviar proposta de mentoria",
  "proxima_acao_data": "2026-06-10"
}
```

### Chamada com `curl` (via API key)

```bash
curl -X POST https://mentoria.crm.better-knowledge.com/api/clientes \
  -H "Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"nome":"Maria Silva","origem":"Instagram","etapa":"qualificacao","valor_estimado":12000,"proxima_acao":"Enviar proposta","proxima_acao_data":"2026-06-10"}'
```

### Resposta `201 Created`

```json
{
  "id": 29,
  "nome": "Maria Silva",
  "empresa": "Acme Consultoria",
  "cargo": "Diretora de Operações",
  "telefone": "+5511999998888",
  "email": "maria@acme.com.br",
  "tipo_cliente": "b2b",
  "origem": "Instagram",
  "etapa": "qualificacao",
  "resultado": "em_aberto",
  "valor_estimado": 12000,
  "proposta_enviada": 0,
  "status_pagamento": "aguardando",
  "proxima_acao": "Enviar proposta de mentoria",
  "proxima_acao_data": "2026-06-10",
  "created_by": "ia",
  "created_at": "2026-06-06 14:30:00",
  "updated_at": "2026-06-06 14:30:00"
}
```

---

## Erros possíveis

| HTTP | Corpo | Causa |
|---|---|---|
| `400` | `{"erro":"O campo nome e obrigatorio"}` | `nome` ausente ou vazio. |
| `401` | `{"erro":"Não autenticado"}` | Sem credencial (nem Bearer, nem sessão). |
| `401` | `{"erro":"Chave de API inválida ou revogada"}` | API key inexistente ou revogada. |
| `403` | `{"erro":"Token CSRF inválido"}` | Apenas no fluxo por sessão de navegador sem `X-CSRF-Token` correto. |
| `429` | (rate limit) | Mais de 600 requisições em 15 min pelo mesmo IP. |

---

## Endpoints relacionados (mesma entidade)

| Ação | Rota |
|---|---|
| Listar leads | `GET /api/clientes` |
| Detalhe do lead + interações | `GET /api/clientes/:id` |
| Atualizar lead (mesmos campos acima) | `PUT /api/clientes/:id` |
| Mover etapa / definir resultado | `PUT /api/clientes/:id/etapa` |
| Registrar interação (histórico) | `POST /api/clientes/:id/interacoes` |
| Excluir lead (LGPD) | `DELETE /api/clientes/:id` |
