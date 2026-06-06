# Contract — Catálogo de Ferramentas MCP

**Feature**: `001-mcp-server-auth` · **Server**: `mini-crm` · **Discovery**: JSON-RPC `tools/list`

O servidor MCP expõe **10 ferramentas** com paridade total às operações do CRM (FR-013). Cada
ferramenta declara um `inputSchema` validado pelo SDK antes de chamar `crm-service.js`. Toda escrita
é auditada como `ia` (derivado da credencial — FR-008). Erros de domínio retornam como erro de
ferramenta (`isError: true`), sem gravação parcial (FR-009).

> Convenção de saída: ferramentas retornam o objeto/array do CRM em conteúdo de texto JSON.
> `id` refere-se a `clientes.id`.

---

## Leitura

### `listar_clientes`
- **Descrição**: Lista todos os clientes/leads, com contagem de interações, mais recentes primeiro.
- **Input**: _(nenhum)_
- **Output**: array de clientes.
- **Mapeia**: `GET /api/clientes`.

### `obter_cliente`
- **Descrição**: Retorna a ficha completa de um cliente e seu histórico de interações.
- **Input**: `{ "id": number }` (obrigatório)
- **Output**: cliente + `interacoes[]`. Inexistente → erro "Cliente não encontrado".
- **Mapeia**: `GET /api/clientes/:id`.

### `acoes_hoje`
- **Descrição**: Follow-ups classificados em `atrasados`, `hoje` e `futuros` (clientes em aberto com
  `proxima_acao_data`).
- **Input**: _(nenhum)_
- **Output**: `{ atrasados[], hoje[], futuros[] }`.
- **Mapeia**: `GET /api/hoje`.

### `listar_interacoes`
- **Descrição**: Lista as interações de um cliente, mais recentes primeiro.
- **Input**: `{ "id": number }` (obrigatório)
- **Output**: array de interações.
- **Mapeia**: `GET /api/clientes/:id/interacoes`.

---

## Escrita (auditada como `ia`)

### `criar_cliente`
- **Descrição**: Cria um lead/cliente. Apenas `nome` é obrigatório.
- **Input** (todos os campos de Cliente; ver [data-model.md](../data-model.md)):
  ```json
  {
    "nome": "string (obrigatório)",
    "empresa": "string?", "cargo": "string?", "telefone": "string?", "email": "string?",
    "tipo_cliente": "b2b|autonomo|publico?",
    "origem": "string?",
    "etapa": "novo|qualificacao|reuniao|proposta?",
    "resultado": "em_aberto|ganho|perdido?",
    "valor_estimado": "number?",
    "proposta_enviada": "boolean?",
    "status_pagamento": "string?",
    "proxima_acao": "string?",
    "proxima_acao_data": "YYYY-MM-DD?"
  }
  ```
- **Output**: cliente criado (com `id`, `created_by:"ia"`, timestamps).
- **Regras**: `nome` vazio → erro; `created_by` sempre `ia` (ignora qualquer valor do corpo).
- **Annotations**: `readOnlyHint:false`, `idempotentHint:false`.
- **Mapeia**: `POST /api/clientes`.

### `atualizar_cliente`
- **Descrição**: Atualiza os dados de um cliente existente (merge sobre o registro atual).
- **Input**: `{ "id": number, ...campos de Cliente a alterar }`
- **Output**: cliente atualizado. Inexistente → erro.
- **Annotations**: `readOnlyHint:false`, `idempotentHint:true`, `destructiveHint:true` (sobrescreve).
- **Mapeia**: `PUT /api/clientes/:id`.

### `mover_etapa`
- **Descrição**: Move o cliente no funil e/ou define o resultado.
- **Input**: `{ "id": number, "etapa": "novo|qualificacao|reuniao|proposta"?, "resultado": "em_aberto|ganho|perdido"? }`
  (ao menos um de `etapa`/`resultado`).
- **Output**: cliente atualizado. Enum inválido → erro, sem alterar.
- **Annotations**: `readOnlyHint:false`, `idempotentHint:true`.
- **Mapeia**: `PUT /api/clientes/:id/etapa`.

### `registrar_interacao`
- **Descrição**: Adiciona uma anotação ao histórico de um cliente.
- **Input**: `{ "id": number, "texto": "string (≤ 5000)" }`
- **Output**: interação criada (`gerado_por_ia:1`). Cliente inexistente → erro; texto vazio/longo → erro.
- **Annotations**: `readOnlyHint:false`, `idempotentHint:false`.
- **Mapeia**: `POST /api/clientes/:id/interacoes`.

---

## LGPD (paridade total — FR-013)

### `exportar_cliente`
- **Descrição**: Exporta todos os dados de um cliente (ficha + interações) para portabilidade LGPD.
- **Input**: `{ "id": number }` (obrigatório)
- **Output**: objeto completo do cliente com `interacoes[]`.
- **Annotations**: `readOnlyHint:true`.
- **Mapeia**: `GET /api/clientes/:id/export`.

### `excluir_cliente`
- **Descrição**: **Exclui permanentemente** um cliente e seu histórico (apagamento LGPD). Irreversível.
- **Input**: `{ "id": number }` (obrigatório)
- **Output**: `{ "ok": true, "removido": <id> }`. Inexistente → erro "Cliente não encontrado".
- **Annotations**: `readOnlyHint:false`, `idempotentHint:true`, `destructiveHint:true` — o cliente de
  IA deve pedir confirmação antes de chamar.
- **Mitigação**: ação autenticada, auditada e sob rate limit; contenção via revogação da credencial.
- **Mapeia**: `DELETE /api/clientes/:id`.

---

## Contrato de descoberta

- `tools/list` retorna exatamente estas 10 ferramentas, cada uma com `name`, `description`,
  `inputSchema` e `annotations`.
- Acrescentar/renomear/alterar o schema de qualquer ferramenta é mudança de contrato e DEVE atualizar
  este arquivo e a documentação (README/docs) no mesmo conjunto de alterações (Princípio V).
