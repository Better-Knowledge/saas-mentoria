# Phase 1 — Data Model: Resumo automático de reunião

**Feature**: `002-resumo-reuniao-ia` | **Date**: 2026-08-23

Todas as migrações são **aditivas e idempotentes**, executadas no boot (RNF-12). Nenhuma tabela
existente é redefinida; nenhuma coluna existente muda de tipo ou some.

---

## Visão geral

```
clientes ──1:N── interacoes ──0:1── transcricoes
    │                 │
    │                 └── revisao / revisado_por / revisado_em / rascunho_origem
    │
    └──1:N── resumo_rascunhos   (transitório: some ao confirmar ou descartar)

auditoria   (sem FK — sobrevive à exclusão do cliente)
```

---

## Tabela nova: `resumo_rascunhos`

Estado transitório entre a extração e a decisão humana. Não é conteúdo do cliente.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `cliente_id` | INTEGER NOT NULL | FK `clientes(id)` ON DELETE CASCADE |
| `payload` | TEXT NOT NULL | JSON do rascunho: `{ resumo, decisoes[], proximos_passos[], objecoes[], sugestao_proxima_acao }` |
| `transcricao_texto` | TEXT NOT NULL | Transcrição original, ainda **não** promovida a `transcricoes` |
| `dono_tipo` | TEXT NOT NULL | `humano` \| `ia` — de qual plano de credencial nasceu |
| `dono_id` | INTEGER NOT NULL | `usuarios.id` ou `api_keys.id`, conforme `dono_tipo` |
| `modelo` | TEXT | Identificador do modelo que produziu — rastreabilidade |
| `tokens_entrada`, `tokens_saida` | INTEGER | Custo observado da chamada |
| `created_at` | TEXT | `datetime('now','localtime')` |

**Regras**
- Um rascunho é visível **apenas** ao seu dono, comparando `dono_tipo` + `dono_id` com o principal
  autenticado (FR-025). Dono diferente → `404`, não `403`: não se confirma a existência de rascunho
  alheio.
- Rascunho é **consumido**: confirmar ou descartar apaga a linha. Não existe rascunho confirmado.
- Rascunhos com mais de **24 h** são apagados pela mesma rotina de purga — extração que ninguém
  reviu não fica guardando transcrição indefinidamente.
- `ON DELETE CASCADE` cobre o caso de o cliente ser excluído durante a revisão (edge case da spec).

**Índice**: `idx_rascunho_dono (dono_tipo, dono_id, created_at)`.

---

## Tabela nova: `transcricoes`

A fonte conferível, retida por 90 dias (decisão Q2).

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `interacao_id` | INTEGER NOT NULL UNIQUE | FK `interacoes(id)` ON DELETE CASCADE |
| `cliente_id` | INTEGER NOT NULL | FK `clientes(id)` ON DELETE CASCADE — redundante de propósito, para a purga não precisar de join |
| `texto` | TEXT NOT NULL | Transcrição como colada, **sem** mascaramento (o mascaramento é só do que sai para o modelo) |
| `expira_em` | TEXT NOT NULL | Data ISO = data da gravação + 90 dias. Calculada na inserção, nunca vinda do cliente |
| `created_at` | TEXT | |

**Regras**
- Apagada quando `expira_em < hoje` (FR-026a), quando o cliente é excluído (FR-026b, via cascata) e
  quando a interação é excluída.
- **Não entra em `exportarCliente()`** (FR-026c). Isso exige teste explícito, porque a função hoje
  monta o export a partir do que encontra — é fácil alguém "consertar" para incluir.
- Ausência de transcrição é estado normal, não erro: interação com mais de 90 dias devolve
  `{ disponivel: false, motivo: 'expirada' }`, nunca `404` seco (edge case da spec).

**Índice**: `idx_transcricao_expira (expira_em)` — a purga varre por data.

---

## Tabela nova: `auditoria`

**Schema idêntico ao do PRD §8.2 (RF-84).** Não é desenho novo: é a tabela da fundação v2 sendo
criada aqui porque esta feature precisa dela primeiro. Quando a fundação chegar, encontra a tabela
pronta e a migração idempotente não faz nada.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `entidade` | TEXT NOT NULL | `cliente` \| `interacao` \| `usuario` \| `api_key` |
| `entidade_id` | INTEGER NOT NULL | |
| `acao` | TEXT NOT NULL | `criar` \| `atualizar` \| `excluir` |
| `campo` | TEXT | NULL em criar/excluir |
| `valor_anterior`, `valor_novo` | TEXT | |
| `autor` | TEXT NOT NULL | `humano` \| `ia` |
| `credencial` | TEXT NOT NULL | `sessao` \| `apikey` |
| `credencial_id` | INTEGER | |
| `created_at` | TEXT | |

**Sem FK para `clientes`, por decisão já registrada no PRD**: o registro precisa sobreviver à exclusão
do cliente — apagar o dado pessoal é direito do titular, apagar a prova de que ele foi apagado não é.

**Regra que esta feature acrescenta**: `valor_anterior` e `valor_novo` **nunca** recebem conteúdo de
transcrição nem texto de resumo (FR-022). O que se grava é o nome do campo e, quando é campo de
negócio, o valor do campo — não a fala que o originou.

**Eventos gravados por esta feature**

| Quando | entidade | acao | campo | Observação |
|---|---|---|---|---|
| Confirmação do rascunho | `interacao` | `criar` | NULL | `autor`/`credencial` do principal; distingue revisão humana de máquina |
| Promoção de próxima ação | `cliente` | `atualizar` | `proxima_acao`, `proxima_acao_data` | Atribuída a **quem confirmou**, nunca à IA (FR-021) |
| Descarte de rascunho | — | — | — | Não gera linha de conteúdo; nada foi criado |

---

## Colunas novas em `interacoes` (aditivas)

| Coluna | Tipo | Regra |
|---|---|---|
| `revisao` | TEXT | `humana` \| `sem_revisao` \| NULL. NULL = interação comum, anterior a esta feature |
| `revisado_por` | INTEGER | `usuarios.id` de quem confirmou; NULL quando `revisao = 'sem_revisao'` |
| `revisado_em` | TEXT | Timestamp da confirmação |
| `origem_registro` | TEXT | `resumo_reuniao` nas criadas por esta feature; NULL nas demais |

**Por que quatro colunas e não uma tabela separada**: são atributos da própria interação, com
cardinalidade 1:1 e sempre lidos junto com ela. Tabela à parte exigiria join em toda listagem de
histórico para exibir um badge.

**Compatibilidade**: `gerado_por_ia` continua sendo a marca de autoria existente e não muda de
significado. `revisao` responde uma pergunta diferente — não "quem escreveu", mas "alguém conferiu".
As duas colunas juntas produzem os três estados que a ficha precisa exibir:

| `gerado_por_ia` | `revisao` | Exibição |
|---|---|---|
| 0 | NULL | Anotação humana comum — sem badge |
| 1 | `humana` | Badge IA + "revisado por Fulano" |
| 1 | `sem_revisao` | Badge IA + chip de atenção "não revisado" |

---

## Estrutura do `payload` do rascunho

Um único schema `zod`, usado em três lugares: formato de saída do modelo, validação do que volta na
confirmação, e `inputSchema` das ferramentas MCP (Princípio IV — sem estrutura paralela).

```
resumo                  string, 1..2000 caracteres
decisoes                array de { texto: string 1..500 }
proximos_passos         array de { texto: string 1..500, responsavel: string|null, prazo: date|null }
objecoes                array de { texto: string 1..500 }
sugestao_proxima_acao   { texto: string|null, data: date|null } | null
```

**Regras de validação na confirmação**
- Pelo menos um entre `resumo` não vazio ou um item em qualquer lista (FR-011).
- Texto final gravado na interação respeita o limite de **5000 caracteres** já vigente para
  interações — o mesmo `ErroDominio` de hoje, não um novo.
- `prazo` e `data` em `YYYY-MM-DD`, validados pela mesma função de data do restante do produto
  (FR-018, RF-89). Formato diferente → `400`, cliente inalterado.
- Campos de autoria e de revisão **não existem** no schema — não há como enviá-los (FR-073 do PRD).

---

## Transições de estado

```
(sem rascunho)
      │  POST extrair
      ▼
   RASCUNHO ──── DELETE descartar ────► (sem rascunho, nada gravado)
      │
      │  POST confirmar
      ▼
  INTERAÇÃO gravada  +  TRANSCRIÇÃO (90 dias)  [+ CLIENTE atualizado, só se promoveu ação]
      │
      │  90 dias
      ▼
  INTERAÇÃO gravada  (transcrição descartada)
```

Estados inválidos e como falham: confirmar rascunho já consumido → `404`; confirmar rascunho de outro
dono → `404`; confirmar com todas as listas vazias e resumo vazio → `400`; confirmar com o cliente já
excluído → `404` (a cascata já removeu o rascunho).
