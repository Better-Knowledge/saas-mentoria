# Roadmap — Mini CRM

> **Versão:** 1.0 · 16/08/2026
> **Base:** [`PRD-Reconstrucao-CRM.md`](PRD-Reconstrucao-CRM.md) — tudo aqui pressupõe a v2 entregue
> **Regra:** nada entra no código sem estar aqui ou no PRD. Ideia nova vira linha nesta lista.

---

## Visão em uma frase

Hoje o CRM é um **registro**: alguém conta a ele o que aconteceu. O roadmap o transforma em um
**participante**: ele recebe a conversa, entende, registra sozinho e devolve — sempre com a pessoa
no controle do que sai.

```
v2 (hoje)          F1              F2              F3              F4            F5
   │                │               │               │               │             │
Registro  →   Recebe do   →   Entende a   →   Responde e   →   Alcança em   →   Antecipa
              WhatsApp        conversa        entrega          escala          o próximo passo

              handoff         resumo IA       devolutivas     campanhas       previsão e
              → lead          → interação     orçamentos      segmentadas     sugestão
```

---

## Panorama das fases

| Fase | Tema | Entrega central | Esforço | Depende de |
|---|---|---|---|---|
| **F1** | Canal de entrada | WhatsApp conectado, handoff de conversa vira lead | ~3 semanas | v2 |
| **F2** | Inteligência | Resumo de conversa por IA vira interação registrada | ~2 semanas | F1 |
| **F3** | Canal de saída | Devolutivas, documentos e orçamentos enviados pelo CRM | ~3 semanas | F1 |
| **F4** | Escala | Campanhas segmentadas com controle de consentimento | ~4 semanas | F3 |
| **F5** | Antecipação | Lembretes multicanal, agenda, sugestão de próximo passo | ~3 semanas | F2 |
| **F6** | Plataforma | Multi-tenant, permissões granulares, versionamento de API | a definir | demanda real |

---

# F1 — Canal de entrada: WhatsApp

**Problema que resolve:** o lead chega pelo WhatsApp, a conversa acontece lá, e o CRM só fica
sabendo se alguém digitar tudo de novo. Na prática, ninguém digita.

**Resultado esperado:** toda conversa relevante do WhatsApp existe no CRM como lead, com o histórico
anexado, sem trabalho manual de transcrição.

## F1.1 Camada de adaptador de provedor

A decisão mais importante da fase — e a que precisa vir **antes** de qualquer integração concreta.

Nenhum código de negócio conhece o nome do provedor. Existe uma interface única, e cada provedor é
um adaptador que a implementa:

```js
// whatsapp/provider.js — contrato único
// Toda implementação (Evolution, Z-API, ou o que vier depois) devolve e recebe
// exatamente estas formas. O crm-service nunca vê JSON de fornecedor.
{
  enviarTexto({ para, texto }),
  enviarMidia({ para, url, tipo, legenda, nomeArquivo }),
  enviarTemplate({ para, template, variaveis }),
  normalizarWebhook(payloadCru),   // → MensagemNormalizada
  statusConexao(),
}
```

**Formato normalizado de mensagem** — o único que circula dentro do CRM:

```json
{
  "provedor": "evolution | zapi",
  "instancia": "consultoria-01",
  "externo_id": "3EB0...",
  "direcao": "entrada | saida",
  "telefone": "5511999999999",
  "nome_perfil": "Maria Souza",
  "tipo": "texto | imagem | audio | documento | contato",
  "texto": "Oi, vi sua palestra e queria um orçamento",
  "midia_url": null,
  "timestamp": "2026-08-16T14:32:00-03:00"
}
```

| Provedor | Papel no projeto | Observação |
|---|---|---|
| **Evolution API Cloud** | Adaptador primário | Hospedado, multi-instância, webhook por evento. Baseado em conexão não oficial ao WhatsApp |
| **Z-API** | Adaptador alternativo | Contrato REST próprio, mesma normalização. Também não oficial |
| *(Cloud API oficial da Meta)* | Adaptador futuro | Entra sem refatoração quando o volume justificar o custo por conversa e a exigência de templates aprovados |

> **Risco a assumir por escrito:** Evolution e Z-API operam por conexão **não oficial** ao WhatsApp.
> O número pode ser bloqueado pela Meta — especialmente com disparo em volume (ver F4). O adaptador
> existe precisamente para que trocar de provedor, inclusive para a API oficial, seja uma troca de
> arquivo e não uma reescrita. **Não desenhe nada que dependa de um fornecedor específico.**

### Configuração
Tela **Integrações → WhatsApp** (somente admin): provedor, URL base, token da instância, número
conectado, URL de webhook gerada pelo CRM e teste de conexão. O token é guardado com o mesmo
tratamento das chaves de API — **nunca exibido depois de salvo**.

## F1.2 Recebimento de mensagens

Endpoint `POST /api/webhooks/whatsapp/:provedor`, com:

- **Validação de assinatura** do provedor. Sem assinatura válida → `401`. Webhook é uma porta aberta
  na internet; tratá-lo como confiável seria um furo grave.
- **Idempotência por `externo_id`** — provedores reenviam. Mensagem repetida é ignorada, não
  duplicada.
- **Resposta imediata `200`** e processamento assíncrono. Provedor que espera não reenvia bem.
- Rate limit dedicado.

**Tabelas novas:**

```sql
CREATE TABLE conversas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provedor TEXT NOT NULL,
  instancia TEXT,
  telefone TEXT NOT NULL,
  nome_perfil TEXT,
  cliente_id INTEGER,                    -- NULL até o handoff virar lead
  estado TEXT NOT NULL DEFAULT 'aberta', -- aberta | vinculada | arquivada
  consentimento TEXT,                    -- optin | optout | desconhecido
  ultima_mensagem_em TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_conversa_tel ON conversas(provedor, instancia, telefone);

CREATE TABLE mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER NOT NULL,
  externo_id TEXT,
  direcao TEXT NOT NULL,                 -- entrada | saida
  tipo TEXT NOT NULL,
  texto TEXT,
  midia_url TEXT,
  status TEXT,                           -- enviada | entregue | lida | falhou
  enviada_por TEXT,                      -- humano | ia | campanha
  timestamp TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_msg_externo ON mensagens(conversa_id, externo_id);
```

## F1.3 Handoff: conversa vira lead

O coração da fase. **Handoff é ato deliberado, não automatismo** — nem toda conversa de WhatsApp é
um lead, e um CRM poluído por conversa aleatória perde a utilidade em uma semana.

**Nova tela: Conversas**

Lista das conversas abertas ainda não vinculadas, com telefone, nome do perfil, prévia da última
mensagem e quando chegou. Cada conversa tem três caminhos:

| Ação | O que acontece |
|---|---|
| **Virar lead** | Abre a ficha de novo cliente **pré-preenchida** com nome do perfil, telefone e `origem = whatsapp`. Ao salvar, a conversa vincula ao cliente e todo o histórico vira interações |
| **Vincular a cliente existente** | Busca por nome ou telefone e associa; o histórico entra na ficha existente |
| **Arquivar** | Some da fila sem virar lead. Reversível |

**Reconhecimento automático:** se o telefone da conversa já bate com o de um cliente cadastrado,
a vinculação é sugerida na hora — com confirmação de uma pessoa, nunca silenciosa.

**Vinculação por agente de IA:** um agente pode chamar `criar_lead_de_conversa` via MCP. A criação é
gravada com `created_by = 'ia'`, o mesmo tratamento de qualquer escrita de máquina, e aparece
marcada no dashboard na proporção humano × IA que já existe.

### Endpoints
| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/conversas` | Lista conversas, com filtro por estado |
| GET | `/api/conversas/:id/mensagens` | Histórico da conversa |
| POST | `/api/conversas/:id/handoff` | Cria lead a partir da conversa |
| POST | `/api/conversas/:id/vincular` | Vincula a cliente existente |
| POST | `/api/conversas/:id/arquivar` | Arquiva |

### Ferramentas MCP
`listar_conversas` · `obter_conversa` · `criar_lead_de_conversa` · `vincular_conversa`

### Critérios de aceite
- [ ] Mensagem recebida no WhatsApp aparece na tela Conversas em menos de 10 segundos
- [ ] Webhook sem assinatura válida é rejeitado com `401`
- [ ] Mesmo `externo_id` entregue duas vezes gera **uma** mensagem
- [ ] Handoff cria o cliente com `origem = whatsapp` e importa o histórico como interações
- [ ] Telefone já cadastrado dispara sugestão de vínculo antes de criar duplicata
- [ ] Trocar o adaptador de Evolution para Z-API não exige mudança fora de `whatsapp/`
- [ ] Token do provedor não é exibido depois de salvo, nem retornado por nenhuma rota

---

# F2 — Inteligência: resumos de IA

**Problema que resolve:** a conversa importada é longa, cheia de "oi", "tudo bem?" e áudio. Ninguém
relê 80 mensagens antes de uma reunião.

**Resultado esperado:** cada conversa vira uma **interação curta e útil** na ficha do cliente,
marcada como gerada por IA, com os dados estruturados que dá para extrair com segurança.

## F2.1 Resumo de conversa

Ao fazer o handoff — ou sob demanda, por botão na ficha — o CRM envia a conversa a um modelo e
recebe:

```json
{
  "resumo": "Maria assistiu à palestra na FIESP e quer um diagnóstico de automação para o time de atendimento (12 pessoas). Orçamento aprovado até R$ 40 mil. Pediu proposta até sexta.",
  "proxima_acao_sugerida": "Enviar proposta de diagnóstico",
  "proxima_acao_data_sugerida": "2026-08-21",
  "valor_estimado_sugerido": 40000,
  "tipo_cliente_sugerido": "b2b",
  "sinais": ["orçamento definido", "prazo declarado", "decisor identificado"],
  "confianca": 0.82
}
```

**Regras inegociáveis:**

1. **Sugestão nunca é gravação automática em campo de negócio.** Valor, próxima ação e tipo aparecem
   como sugestão para uma pessoa aceitar com um clique. Um modelo confundir "40 mil" com "14 mil"
   custa uma proposta errada.
2. **O resumo em si é gravado como interação** com `gerado_por_ia = 1` e o `.badge-ia` visível —
   isso é registro de conversa, não decisão de negócio.
3. **Minimização antes de enviar ao modelo:** telefone e e-mail são mascarados na carga enviada. O
   modelo precisa do conteúdo, não dos identificadores.
4. **Provedor que não treina com os dados**, declarado em contrato. Está no PRD como compromisso de
   LGPD e vale aqui literalmente.
5. **A transcrição bruta continua acessível** na conversa. Resumo é atalho, não substituto — e se
   ele estiver errado, dá para conferir a fonte.

## F2.2 Transcrição de áudio

Áudio é a forma mais comum de mensagem em WhatsApp no Brasil e a que mais se perde. Áudio recebido é
transcrito, a transcrição entra na conversa como mensagem de tipo `audio` com texto, e alimenta o
resumo como qualquer outra mensagem.

## F2.3 Enriquecimento contínuo

A cada N mensagens novas em conversa **já vinculada**, o resumo é atualizado e uma nova interação é
registrada — o histórico do cliente acompanha a relação sem ninguém digitar.

### Endpoints e ferramentas
| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/conversas/:id/resumir` | Gera resumo e grava como interação |
| POST | `/api/clientes/:id/sugestoes` | Devolve sugestões sem gravar |

MCP: `resumir_conversa` · `sugerir_proximo_passo`

### Critérios de aceite
- [ ] Resumo entra como interação com `gerado_por_ia = 1` e badge visível
- [ ] Nenhum campo de negócio é alterado sem confirmação humana
- [ ] Telefone e e-mail são mascarados na carga enviada ao modelo
- [ ] Áudio recebido gera transcrição associada à mensagem original
- [ ] Falha do provedor de IA não quebra o handoff — a conversa vira lead do mesmo jeito

---

# F3 — Canal de saída: devolutivas, documentos e orçamentos

**Problema que resolve:** a proposta sai do CRM, mas o envio acontece em outro lugar; o CRM não sabe
se foi enviada, se foi lida, nem quando cobrar.

**Resultado esperado:** enviar pelo CRM, com registro automático da saída e do status de entrega.

## F3.1 Envio de mensagem a partir da ficha

Botão **Enviar mensagem** na ficha do cliente que tenha telefone. Abre composição com:

- **Modelos de mensagem** com variáveis (`{{nome}}`, `{{empresa}}`, `{{valor}}`, `{{proxima_acao}}`)
- Prévia com as variáveis já substituídas — sempre, antes de enviar
- Envio registrado como mensagem de saída **e** como interação na ficha
- Atualização de status: enviada → entregue → lida → falhou

**Modelos previstos:** confirmação de reunião · devolutiva pós-reunião · envio de proposta ·
follow-up de proposta sem resposta · agradecimento de fechamento · reativação de lead frio.

```sql
CREATE TABLE modelos_mensagem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT,            -- devolutiva | proposta | followup | reativacao
  corpo TEXT NOT NULL,       -- com {{variaveis}}
  ativo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

## F3.2 Envio de documentos e orçamentos

Anexar PDF, imagem ou planilha ao envio, a partir de arquivo local ou de um documento gerado pelo
próprio CRM.

```sql
CREATE TABLE documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,        -- orcamento | proposta | contrato | anexo
  nome_arquivo TEXT NOT NULL,
  caminho TEXT NOT NULL,
  valor REAL,
  enviado_em TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);
```

**Gerador de orçamento:** formulário com itens, quantidades e valores; gera PDF com a identidade
visual do [Design System](DESIGN-SYSTEM.md); grava em `documentos`; envia pelo WhatsApp; marca
`proposta_enviada = 1` e o `valor_estimado` no cliente — fechando o ciclo que hoje é manual.

## F3.3 Devolutiva automática pós-interação

Ao mover um cliente para determinada etapa, o CRM **sugere** a devolutiva correspondente já
preenchida. Sugere e mostra; **nunca envia sozinho**. Mensagem sai do sistema com o nome do usuário
— quem assina precisa ter lido.

### Endpoints e ferramentas
| Método | Rota | O que faz |
|---|---|---|
| GET/POST | `/api/modelos` | Lista / cria modelos |
| POST | `/api/clientes/:id/mensagens` | Envia mensagem ao cliente |
| POST | `/api/clientes/:id/documentos` | Anexa e envia documento |
| POST | `/api/clientes/:id/orcamento` | Gera orçamento em PDF |

MCP: `listar_modelos` · `preparar_mensagem` (**prepara, não envia**) · `enviar_mensagem` (com
`destructiveHint`, porque toca uma pessoa real do lado de fora)

### Critérios de aceite
- [ ] Mensagem enviada aparece na conversa e como interação na ficha
- [ ] Status de entrega e leitura é atualizado pelo webhook do provedor
- [ ] Falha de envio é visível na interface, com o motivo
- [ ] Prévia com variáveis substituídas é obrigatória antes do envio
- [ ] Orçamento gerado marca `proposta_enviada` e `valor_estimado`
- [ ] Agente de IA prepara mensagem, mas o envio exige confirmação humana explícita

---

# F4 — Escala: campanhas

**Problema que resolve:** reativar 200 leads frios um a um não acontece.

**Resultado esperado:** disparo segmentado, com controle de consentimento e limite de velocidade —
sem transformar o número em alvo de bloqueio.

## F4.1 Segmentação

Público montado por filtros combinados sobre dados que o CRM já tem: etapa, resultado, origem, tipo
de cliente, faixa de valor, dias sem movimentação, com ou sem proposta enviada, consentimento.

Toda campanha mostra **a lista de destinatários antes do disparo**. Campanha que não deixa ver quem
vai receber é campanha que vai errar.

## F4.2 Consentimento e opt-out — condição de existência

Isto não é um recurso da fase. É o que autoriza a fase a existir.

| Regra | Implementação |
|---|---|
| Só recebe campanha quem tem `consentimento = 'optin'` | Filtro obrigatório, não removível pela interface |
| Toda mensagem de campanha traz saída | Sufixo com instrução de descadastro |
| Palavras de saída registradas automaticamente | "sair", "parar", "descadastrar" → `optout` imediato |
| Opt-out é definitivo | Nenhuma campanha alcança quem saiu. Conversa individual continua permitida |
| Registro de origem do consentimento | Quando, como e por qual canal foi obtido |

## F4.3 Execução com fila

```sql
CREATE TABLE campanhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  modelo_id INTEGER,
  filtro_json TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | agendada | executando | concluida | cancelada
  agendada_para TEXT,
  intervalo_segundos INTEGER DEFAULT 45,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE campanha_destinatarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campanha_id INTEGER NOT NULL,
  cliente_id INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendente',  -- pendente | enviada | entregue | lida | respondida | falhou | pulada
  mensagem_id INTEGER,
  erro TEXT,
  FOREIGN KEY (campanha_id) REFERENCES campanhas(id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);
```

**Proteções obrigatórias:**

- **Intervalo entre envios** configurável, com padrão conservador (~45 s). Rajada é o caminho mais
  curto para o bloqueio do número.
- **Teto diário** por instância.
- **Janela de horário** — nada fora do horário comercial.
- **Pausa automática** se a taxa de falha passar de um limite: sinal claro de que o número está sob
  restrição.
- **Cancelamento a qualquer momento**, com os pendentes marcados como `pulada`.

> **Risco explícito:** campanha em volume por provedor não oficial é o cenário de maior chance de
> bloqueio do número. Se o volume justificar, é aqui que o adaptador da **Cloud API oficial** entra —
> com custo por conversa e templates aprovados previamente, em troca de disparo sem risco de banimento.

## F4.4 Resultado da campanha

Enviados, entregues, lidos, respondidos, falhas, opt-outs gerados e **negócios movidos no funil por
quem recebeu** — a única métrica que responde se a campanha valeu.

### Critérios de aceite
- [ ] Campanha só alcança contatos com `optin`
- [ ] Lista de destinatários é exibida antes do disparo
- [ ] Intervalo, teto diário e janela de horário são respeitados
- [ ] Resposta com palavra de saída gera `optout` imediato
- [ ] Campanha pode ser cancelada em execução
- [ ] Taxa de falha acima do limite pausa a campanha automaticamente
- [ ] Toda mensagem enviada aparece na ficha do cliente

---

# F5 — Antecipação: lembretes, agenda e sugestão

**Problema que resolve:** a tela Hoje só ajuda quem abre a tela Hoje.

| Entrega | Descrição |
|---|---|
| **Lembrete no WhatsApp** | Resumo diário das ações de hoje e atrasadas, no seu próprio número |
| **Lembrete por e-mail** | Mesmo conteúdo, para quem prefere caixa de entrada |
| **Google Agenda** | Próxima ação com data vira evento; mover a data no CRM move o evento |
| **Sugestão de próximo passo** | A partir do histórico e das métricas, a IA sugere o que fazer com cada lead parado |
| **Alerta de proposta esquecida** | Proposta enviada há mais de N dias sem desfecho dispara aviso |
| **Previsão de receita** | Projeção do mês a partir do pipeline ponderado e do ciclo médio real |

---

# F6 — Plataforma

Só entra quando houver demanda real — construir antes disso é custo sem retorno.

| Item | Gatilho |
|---|---|
| Multi-tenant | Um segundo cliente querendo a mesma instalação |
| Permissões granulares por campo e por carteira | Equipe acima de 3 pessoas |
| Versionamento de API (`/v1`) | Um segundo consumidor externo estável |
| Migração de SQLite para PostgreSQL | Concorrência de escrita virando gargalo real |
| Aplicativo móvel | Uso fora do desktop virando rotina |
| OAuth do MCP | Agentes de terceiros precisando de acesso delegado |

---

## Riscos transversais

| Risco | Fase | Impacto | Mitigação |
|---|---|---|---|
| Bloqueio do número pelo WhatsApp | F1, F4 | Canal principal fora do ar | Adaptador troca provedor; limites de velocidade; caminho para API oficial |
| Provedor não oficial descontinuado | F1 | Reescrita da integração | Contrato único de adaptador desde o primeiro dia |
| IA extrair valor errado da conversa | F2 | Proposta com valor incorreto | Sugestão nunca grava sozinha em campo de negócio |
| Vazamento de conversa para o provedor de IA | F2 | Exposição de dado confidencial de cliente | Minimização, mascaramento, provedor que não treina com os dados |
| Campanha vista como spam | F4 | Dano à reputação e à marca | Opt-in obrigatório, opt-out imediato, limite de volume |
| CRM poluído por conversa irrelevante | F1 | Perda de utilidade da base | Handoff deliberado, nunca criação automática de lead |
| Webhook público explorado | F1 | Injeção de dado falso na base | Validação de assinatura, idempotência, rate limit |

---

## Compromissos que valem em todas as fases

Herdados do [PRD](PRD-Reconstrucao-CRM.md) e não negociáveis por conveniência de integração:

1. **A lógica de negócio continua em `crm-service.js`.** Integração é adaptador na borda, nunca
   regra nova escondida em um webhook.
2. **Paridade REST ↔ MCP.** Capacidade nova nasce nos dois caminhos, ou nasce justificada por
   escrito em apenas um.
3. **OpenAPI atualizado na mesma entrega.** Documentação desatualizada é defeito, não pendência.
4. **Autoria derivada da credencial.** Mensagem enviada por campanha, por agente ou por pessoa fica
   distinguível para sempre.
5. **Ação que toca alguém de fora exige confirmação humana.** Agente prepara; pessoa envia.
6. **Segredo de integração recebe o tratamento de chave de API.** Guardado com hash ou cifrado,
   exibido uma vez, revogável individualmente.
7. **Exportar e excluir cliente passam a incluir conversas, mensagens e documentos.** Direito do
   titular não tem exceção por ser dado de integração.
