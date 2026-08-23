# Contrato MCP — Resumo de reunião

**Feature**: `002-resumo-reuniao-ia` | Entra em `mcp/tools.mjs` e em `docs/MCP.md` no mesmo commit.

Paridade exigida pelo Princípio V: **toda operação REST desta feature tem ferramenta MCP
equivalente**, chamando a mesma camada de serviço. Zero lógica de domínio em `mcp/`.

Todas exigem `Authorization: Bearer` válido — sem credencial, `401`, nunca modo anônimo (RF-67).

---

## Mapa de paridade

| Ferramenta MCP | Rota REST equivalente | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
|---|---|---|---|---|
| `extrair_resumo_reuniao` | `POST /api/clientes/{id}/resumos` | false | false | false |
| `obter_rascunho_resumo` | `GET /api/resumos/{id}` | true | false | true |
| `confirmar_resumo_reuniao` | `POST /api/resumos/{id}/confirmar` | false | false | false |
| `descartar_resumo_reuniao` | `DELETE /api/resumos/{id}` | false | **true** | true |
| `obter_transcricao` | `GET /api/interacoes/{id}/transcricao` | true | false | true |

`openWorldHint: true` em `extrair_resumo_reuniao` — é a única ferramenta do catálogo que alcança um
serviço externo, e o agente merece saber disso antes de chamar.

---

## Descrições que o agente lê

- **`extrair_resumo_reuniao`** — "Extrai decisões, próximos passos e objeções de uma transcrição de
  reunião e devolve um rascunho para revisão. **Não grava nada** no histórico do cliente. Cada chamada
  aciona um serviço externo de IA e tem custo."
- **`confirmar_resumo_reuniao`** — "Grava o rascunho revisado como interação no histórico do cliente.
  **Quando chamada por uma chave de API, o registro é gravado como não revisado por humano** e assim
  aparece na ficha. Não altera nenhum campo de negócio do cliente."
- **`descartar_resumo_reuniao`** — "Descarta o rascunho permanentemente. **Irreversível**: a
  transcrição associada é apagada junto e a extração precisaria ser refeita, com novo custo."

O alerta de irreversibilidade em `descartar_resumo_reuniao` é exigência do PRD RF-78.

---

## Fronteiras deliberadas

1. **Nenhum `inputSchema` aceita campo de autoria ou de revisão** (RF-73, FR-019). O agente não pode
   se declarar humano nem marcar o próprio registro como revisado — isso vem da credencial.
2. **Promover próxima ação não está no `inputSchema` de `confirmar_resumo_reuniao`.** Um agente que
   queira mudar a próxima ação usa `atualizar_cliente`, que já existe (FR-028c). Isso mantém a regra
   "extração nunca escreve em campo de negócio" idêntica nos dois planos, e mantém a alteração de
   campo separada e auditável.
3. **Rascunho criado por chave A não é visível à chave B.** O dono é a credencial, não "a máquina".

---

## Erros

Erros de domínio chegam ao agente com **a mesma mensagem da API** (RF-77). O `503` de serviço de IA
indisponível vira erro MCP legível dizendo se o serviço está desconfigurado ou apenas falhou — o
agente precisa distinguir "não adianta tentar de novo" de "tente mais tarde".

---

## Teste de paridade

`tests/parity.test.js` (RF-80) verifica que toda função exportada por `crm-service.js` com equivalente
REST tem ferramenta MCP correspondente. As cinco funções desta feature entram nessa verificação sem
exceção nem lista de dispensa.
