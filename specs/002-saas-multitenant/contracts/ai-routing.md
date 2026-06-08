# Contract — IA Claude: Roteamento por Tarefa e Governança de Custo

**Feature**: `002-saas-multitenant`

Define como cada tarefa de IA escolhe o **modelo Claude**, como o custo é **controlado** e como o
consumo é **medido e limitado por organização** (Princípio VII / FR-023..025). IDs de modelo ficam em
**configuração** (trocáveis sem mexer na lógica).

## Roteamento por tarefa

| Tarefa | Modelo padrão (config) | Plano | Por quê |
|---|---|---|---|
| `sentimento` (rótulo positivo/neutro/negativo) | **Haiku** `claude-haiku-4-5` | VIP | classificação curta, alto volume, mais barato/rápido |
| `triagem`/`intencao`/`extracao_lead` (nome, intenção do contato) | **Haiku** | VIP | idem — decisão simples sobre 1 mensagem |
| `resumo` (conversa multi-mensagem → resumo no histórico) | **Sonnet** `claude-sonnet-4-6` | VIP | qualidade de síntese no caso geral |
| `gordon` (assistente de chat que opera o CRM) | **Sonnet** | todos | equilíbrio qualidade/custo; usa ferramentas do CRM |
| `auto_resposta` (resposta ao lead) | **Sonnet** (escala a **Opus** sob baixa confiança/complexidade) | VIP | redação correta; escalonar só quando preciso |
| `relatorio` (narrativa de relatório avançado) | **Sonnet** | Inter/VIP | texto sob dados agregados |
| `raciocinio_complexo` (análise multi-passo escalada) | **Opus** `claude-opus-4-8` | VIP | reservado ao que exige a maior capacidade |

- **Escalonamento**: começar no modelo mais barato que costuma resolver; subir (Sonnet→Opus) só quando a
  saída do modelo menor indicar baixa confiança ou a tarefa for marcada como complexa. Nunca o contrário.
- A escolha vem de `ai/router.js` (mapa tarefa→modelo em config), não espalhada pelo código.

## Controles de custo

1. **Cache de prompt** (`cache_control`): instruções de sistema e contexto estável (catálogo de
   ferramentas do Gordon, regras de resumo/sentimento) marcados como cacheáveis → input repetido cobra
   muito menos. Aplicar em Gordon e nos prompts de tarefa.
2. **Processamento em lote** (Batch API) para jobs **não interativos** em massa (re-resumo periódico,
   sentimento em lote) → desconto sobre o uso síncrono. Tarefas interativas (Gordon, auto-resposta)
   ficam síncronas.
3. **Janela mínima**: enviar só o necessário — **resumir-e-armazenar** para não reenviar o histórico
   inteiro a cada chamada; `max_tokens` por tarefa; truncar/limitar contexto.
4. **Orçamento por organização** (`ai_usage` + teto por plano): antes de chamar, checar o consumo do
   período; ao se aproximar do teto → **degradar** (Opus→Sonnet→Haiku) ou **enfileirar/bloquear** com
   aviso ao usuário. Nunca estourar custo (FR-024).
5. **Medição**: cada chamada registra em `ai_usage` (org, tarefa, modelo, input/output/cached tokens,
   `custo_centavos`), calculando o custo pela **tabela de preços em config** (confirmar os valores
   vigentes por modelo na implementação — a skill `claude-api` traz a referência atual de preços e do
   suporte a cache/lote).

## Contratos das tarefas (resumo)

- **`ai.sentiment`** (input: 1 mensagem/conversa curta) → `{ sentimento: 'positivo'|'neutro'|'negativo',
  confianca }`. Grava `interacoes(tipo='sentimento', metadata)` e/ou campo no lead. Haiku.
- **`ai.summarize`** (input: mensagens da conversa do lead) → resumo conciso. Grava
  `interacoes(tipo='resumo_ia', gerado_por_ia=true)`. Sonnet, com cache das instruções.
- **`ai.autoreply`** (input: contexto do lead + última mensagem) → texto de resposta + decisão de
  **handoff** (se exige humano). Se aprovado, `WhatsAppProvider.sendMessage` e grava saída marcada IA.
  Sonnet→Opus por escalonamento. Sujeito a regras de ativação por org.
- **`gordon`** (chat interativo): usa as ferramentas do CRM da org (camada `crm-service`/MCP) para
  ler/escrever; respostas e ações respeitam `entitlements`. Sonnet + cache do prompt de sistema/
  ferramentas. Escritas auditadas como `ia` + `org_id`.

## Segurança, privacidade e invariantes

- **Mínimo necessário** enviado à IA; sub-processador (Anthropic) **não treina** com dados de API
  (Princípio II / FR-025). Dados de cartão nunca vão à IA.
- Toda saída de IA gravada tem `gerado_por_ia=true` e fica no histórico do lead (rastreável).
- **Teto por org** respeitado antes de qualquer chamada; sem caminho de gasto ilimitado por request.
- IDs de modelo e preços em **config** (trocáveis); roteamento por tarefa é a fonte única da escolha.
- Tarefas de IA rodam em **jobs** (pg-boss), em `withOrg(org_id)` — isolamento mantido também no
  assíncrono.
- Auto-atendimento tem **handoff** para humano e rate limit de envio (evita spam/ban da linha).
