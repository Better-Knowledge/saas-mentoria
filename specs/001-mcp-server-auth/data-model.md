# Data Model — Servidor MCP Autenticado

**Feature**: `001-mcp-server-auth` · **Date**: 2026-06-06

> **Sem mudança de schema na v1.** A funcionalidade reaproveita as tabelas existentes
> (`api_keys`, `clientes`, `interacoes`, `usuarios`, `sessoes`). Esta página descreve como essas
> entidades são usadas pelo caminho MCP e os schemas de entrada/saída das ferramentas.

## Entidades reaproveitadas

### Credencial de Agente (= linha de `api_keys`)

A credencial Bearer de um agente MCP **é** um registro de `api_keys` — não há tabela nova.

| Campo | Tipo | Uso no MCP |
|---|---|---|
| `id` | INTEGER PK | Identidade do principal (`req.principal.id`) registrada na auditoria. |
| `nome` | TEXT | Rótulo da integração de IA (ex.: "Agente WhatsApp"). |
| `prefixo` | TEXT | Parte visível para o dono identificar a chave na tela Integrações. |
| `key_hash` | TEXT | Só o `sha256` do segredo; o segredo é mostrado uma única vez. |
| `ativa` | INTEGER (0/1) | Revogação independente: `0` → `verificarApiKey` retorna null → `401`. |
| `ultimo_uso` | TEXT | Atualizado a cada chamada MCP autenticada (monitoramento — FR-012). |
| `criada_por` | INTEGER FK→usuarios | Qual admin emitiu a credencial. |
| `created_at` | TEXT | Quando foi emitida. |

- **Regras**: emissão e revogação só por admin via sessão (fluxo já existente
  `POST /api/keys` / `DELETE /api/keys/:id`). A v1 **não** adiciona escopos por chave (toda chave dá
  acesso ao conjunto completo de ferramentas — Assumption do spec).
- **Evolução planejada (fora da v1)**: coluna opcional `escopo` (ex.: `leitura`/`total`) e/ou tokens
  OAuth do MCP, encaixados atrás da mesma abstração de resolução de credencial (research D4).

### Cliente / Lead (= linha de `clientes`)

Lida e escrita pelas ferramentas. Campos e regras (idênticos à API REST, via `crm-service.js`):

| Campo | Tipo | Obrigatório | Default | Valores válidos / regra |
|---|---|:--:|---|---|
| `nome` | string | **Sim** | — | trim; vazio → erro de validação |
| `empresa`,`cargo`,`telefone`,`email` | string | Não | `null` | texto livre (sem validação de formato) |
| `tipo_cliente` | string | Não | `b2b` | `b2b`·`autonomo`·`publico` (não validado no servidor; convenção) |
| `origem` | string | Não | `null` | texto livre |
| `etapa` | string | Não | `novo` | **enum** `novo`·`qualificacao`·`reuniao`·`proposta` (fora da lista → `novo`) |
| `resultado` | string | Não | `em_aberto` | **enum** `em_aberto`·`ganho`·`perdido` (fora da lista → `em_aberto`) |
| `valor_estimado` | número | Não | `0` | ≥ 0; não numérico → `0` |
| `proposta_enviada` | booleano | Não | `false` | truthy → `1` |
| `status_pagamento` | string | Não | `null` | texto livre |
| `proxima_acao` | string | Não | `null` | texto livre |
| `proxima_acao_data` | string | Não | `null` | **`YYYY-MM-DD`** (a tela "Hoje" compara como texto) |
| `created_by` | string | — | derivado | **`ia`** quando criado via MCP — nunca do corpo (FR-008) |
| `created_at`/`updated_at` | string | — | automático | timestamp local do servidor |

- **Whitelist**: a montagem de cliente continua sendo um whitelist de campos (sem mass assignment).
- **Transições de etapa/resultado**: `mover_etapa` aceita `etapa` e/ou `resultado`, validando os enums;
  valores inválidos → erro, sem alterar o registro.

### Interação (= linha de `interacoes`)

| Campo | Tipo | Regra |
|---|---|---|
| `cliente_id` | INTEGER FK→clientes | Cliente alvo deve existir, senão "não encontrado". |
| `texto` | TEXT | obrigatório; trim; tamanho ≤ 5000 |
| `gerado_por_ia` | INTEGER (0/1) | **`1`** quando criado via MCP (derivado da credencial — FR-008) |
| `data`/`created_at` | TEXT | timestamp automático |

- Registrar interação também atualiza `clientes.updated_at` (comportamento atual preservado).

### Usuário / Sessão (`usuarios`, `sessoes`) — sem alteração

Permanecem como o plano de **pessoas** (login UI + CSRF). O caminho MCP **não** os utiliza; servem
apenas para o admin emitir/revogar credenciais na interface.

## Principal (em memória, não persistido)

O middleware Bearer do MCP popula `req.principal` de forma consistente com `auth.requireAuth`:

```text
principal = { tipo: 'ia', credencial: 'apikey', id: <api_keys.id>, nome: <api_keys.nome> }
```

`crm-service` deriva `autor = 'ia'` desse principal para toda escrita.

## Schemas das ferramentas (entrada)

Resumo; o contrato detalhado está em [contracts/mcp-tools.md](contracts/mcp-tools.md).

| Ferramenta | Entrada (campos principais) |
|---|---|
| `listar_clientes` | _(nenhum)_ |
| `obter_cliente` | `id` (number, obrigatório) |
| `acoes_hoje` | _(nenhum)_ |
| `listar_interacoes` | `id` (number, obrigatório) |
| `criar_cliente` | campos de Cliente (acima); só `nome` obrigatório |
| `atualizar_cliente` | `id` + campos de Cliente a alterar |
| `mover_etapa` | `id` + `etapa?` (enum) + `resultado?` (enum) |
| `registrar_interacao` | `id` + `texto` (≤ 5000) |
| `exportar_cliente` | `id` (number, obrigatório) |
| `excluir_cliente` | `id` (number, obrigatório) — **destrutivo/irreversível** |

## Estados e invariantes

- Credencial: `ativa ∈ {0,1}`; revogar é monotônico (1→0). Chave revogada nunca volta a valer.
- Cliente: `etapa` e `resultado` sempre dentro dos enums após qualquer escrita.
- Auditoria: todo registro escrito via MCP tem origem `ia` não falsificável.
