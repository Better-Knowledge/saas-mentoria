# Contrato REST — Resumo de reunião

**Feature**: `002-resumo-reuniao-ia` | Entra em `openapi.yaml` no mesmo commit.

> **Versão do spec.** As operações entram no `openapi.yaml` **como ele está hoje: 3.0.3**, usando
> `nullable: true` como o restante do arquivo. A migração para 3.1 é o RF-54 da fundação v2 e não
> foi arrastada para esta feature — escrever sintaxe 3.1 num documento 3.0.3 produziria um contrato
> que nenhum gerador de client lê corretamente.

Convenções já vigentes no produto: erro sempre `{ "erro": "mensagem" }`; escrita por sessão exige
token CSRF; `Authorization: Bearer` é o plano de máquina. Sem credencial válida → `401`, sempre.

---

## Segurança por operação

| Operação | `cookieAuth` + CSRF | `bearerAuth` |
|---|---|---|
| Criar rascunho | ✅ | ✅ |
| Ler rascunho | ✅ | ✅ |
| Confirmar | ✅ | ✅ (grava `revisao: sem_revisao`) |
| Descartar | ✅ | ✅ |
| Ler transcrição | ✅ | ✅ |

Em todas: o rascunho só é alcançável pelo **dono**; dono diferente responde `404`.

---

## `POST /api/clientes/{id}/resumos`

Cria um rascunho a partir de uma transcrição. **Não grava nada no histórico.**

- **Limite de corpo próprio: 512 KB** (o resto da API segue em 64 KB).
- **Rate limit dedicado**, mais estrito que o geral.

**Request**
```json
{ "transcricao": "string, 1..200000 caracteres" }
```

**Responses**

| Código | Corpo | Quando |
|---|---|---|
| `201` | `RascunhoResumo` | Extração concluída |
| `400` | `Erro` | Transcrição vazia, acima de 200.000 caracteres, ou acima do teto de tokens |
| `401` | `Erro` | Sem credencial válida |
| `403` | `Erro` | CSRF ausente ou inválido (plano de sessão) |
| `404` | `Erro` | Cliente inexistente |
| `413` | `Erro` | Corpo acima de 512 KB |
| `429` | `Erro` | Rate limit da extração |
| `503` | `Erro` | Serviço de IA não configurado, indisponível, ou estourou os 60 s |

`503` é o código de FR-006 e FR-027b: a transcrição não é gravada, nada parcial fica no banco, e a
mensagem distingue "não configurado" de "falhou agora" — são problemas diferentes para quem opera.

---

## `GET /api/resumos/{id}`

Devolve o rascunho ao dono. `404` para qualquer outro. Usado para sobreviver a um reload durante a
revisão.

**Response `200`**: `RascunhoResumo`.

---

## `POST /api/resumos/{id}/confirmar`

Grava o conteúdo **revisado**. O corpo carrega o rascunho como ficou depois da edição — o servidor
grava o que recebe, não o que o modelo produziu (FR-009).

**Request**
```json
{
  "resumo": "string",
  "decisoes": [{ "texto": "string" }],
  "proximos_passos": [{ "texto": "string", "responsavel": "string|null", "prazo": "YYYY-MM-DD|null" }],
  "objecoes": [{ "texto": "string" }],
  "promover_proxima_acao": { "texto": "string", "data": "YYYY-MM-DD" }
}
```

`promover_proxima_acao` é **opcional**. Ausente → cliente inalterado (FR-015, cenário 2 da US2).
Presente e o cliente já tem próxima ação → exige `"substituir": true` no mesmo objeto, senão `409`
com o valor vigente no corpo do erro (FR-017).

**Nenhum campo de autoria ou de revisão existe neste contrato.** Tentar enviar `created_by`,
`gerado_por_ia`, `revisao` ou `revisado_por` é ignorado pela whitelist — a autoria vem da credencial.

**Responses**

| Código | Corpo | Quando |
|---|---|---|
| `201` | `Interacao` (com `revisao`, `revisado_por`, `transcricao_id`) | Gravado |
| `400` | `Erro` | Rascunho vazio (FR-011), texto acima de 5000 caracteres, data inválida |
| `401` / `403` | `Erro` | Credencial / CSRF |
| `404` | `Erro` | Rascunho inexistente, já consumido, de outro dono, ou cliente excluído |
| `409` | `Erro` + `{ "proxima_acao_vigente": {...} }` | Substituição de próxima ação sem confirmação explícita |

---

## `DELETE /api/resumos/{id}`

Descarta. `204` sem corpo. Nada é gravado no histórico (FR-010). `404` se não existe ou não é do dono.

---

## `GET /api/interacoes/{id}/transcricao`

A fonte conferível.

| Código | Corpo | Quando |
|---|---|---|
| `200` | `{ "disponivel": true, "texto": "...", "expira_em": "YYYY-MM-DD" }` | Dentro dos 90 dias |
| `200` | `{ "disponivel": false, "motivo": "expirada" }` | Passados os 90 dias — **não** é erro |
| `404` | `Erro` | Interação inexistente, ou nunca teve transcrição |

---

## Componentes novos em `openapi.yaml`

Em `components/schemas`: `RascunhoResumo`, `ItemExtraido`, `ProximoPasso`, `ConfirmacaoResumo`,
`TranscricaoResposta`. Em `components/responses`: reuso de `Erro400`, `Erro401`, `Erro403Csrf`,
`Erro404` já existentes; acrescenta `Erro409ProximaAcao` e `Erro503Ia`. Em `components/parameters`:
reuso de `IdLead`; acrescenta `IdRascunho` e `IdInteracao`.

`Interacao` ganha as quatro propriedades novas — alteração **aditiva**, sem quebrar cliente existente.

O teste de paridade rota ↔ spec (RF-64) cobre as cinco rotas automaticamente; nenhuma entra na lista
de exclusão.
