# Contract — WhatsApp (Abstração de Provider: Evolution / Z-API)

**Feature**: `002-saas-multitenant` · Recurso **exclusivo do plano VIP** (`requirePlan('whatsapp_ia')`).

Uma linha por organização, conectada por uma API **não oficial**, atrás de uma **interface única** com
adapters intercambiáveis. Objetivo: receber conversas de leads no CRM e alimentar a IA (resumo,
sentimento, auto-atendimento).

## Interface `WhatsAppProvider`

```js
// whatsapp/provider.js — toda implementação (evolution.js, zapi.js) cumpre este contrato.
interface WhatsAppProvider {
  createInstance(org): Promise<{ instance_ref, webhook_secret }>   // provisiona a instância da org
  getConnectionState(org): Promise<'desconectado'|'conectando'|'conectado'>
  getQrCodeOrPairing(org): Promise<{ qr?: string, pairingCode?: string }> // para parear a linha
  sendMessage(org, to, content): Promise<{ provider_msg_id }>      // saída (auto-atendimento)
  logout(org): Promise<void>                                       // encerra a sessão no provider
  parseInbound(rawPayload): NormalizedMessage | null              // normaliza o webhook do provider
  verifyInbound(req, connection): boolean                          // valida segredo/assinatura do inbound
}

// Formato normalizado (independe do provider):
NormalizedMessage = {
  provider_msg_id, // id externo único (idempotência)
  org_id,          // resolvido pela instância
  direcao: 'entrada'|'saida',
  remetente, destinatario, // E.164
  conteudo,        // texto; mídia vira referência em metadata
  metadata,        // tipo de mídia, timestamps do provider
}
```

- Provider ativo escolhido por `WHATSAPP_PROVIDER=evolution|zapi` — **inicialmente `evolution`**
  (auto-hospedada no Docker/Traefik); a Z-API permanece como adapter alternativo. Credenciais por
  provider em env (`EVOLUTION_URL`/`EVOLUTION_API_KEY`, `ZAPI_*`).
- **Evolution** (auto-hospedada): instância por org no servidor Evolution (no Docker/Traefik). **Z-API**
  (gerenciada): instância/token por linha. Os adapters escondem essas diferenças.

## Ciclo de conexão (UI da org VIP)

1. `POST /api/whatsapp/connect` (owner/admin VIP) → `createInstance` + grava `whatsapp_connections`
   (`estado='conectando'`, `webhook_secret` como hash) e registra o webhook do provider apontando para
   `POST /webhooks/whatsapp/:provider`.
2. `GET /api/whatsapp/qr` → `getQrCodeOrPairing` → a UI exibe o **QR Code**/código de pareamento.
3. O usuário lê o QR no celular; o provider passa a `conectado`; `GET /api/whatsapp/status` reflete o
   estado (poll/atualização). `UNIQUE(org_id)` garante **uma linha por org** (FR-019).
4. `POST /api/whatsapp/disconnect` → `logout` + `estado='desconectado'`; auditado.

## Inbound `POST /webhooks/whatsapp/:provider`

- **Identificar a org**: pelo `instance_ref` no payload → `whatsapp_connections.org_id`.
- **Verificar**: `verifyInbound` confere o segredo/assinatura da instância (tempo constante); inválido →
  `401`, sem efeito.
- **Aceitar-e-enfileirar**: responder `2xx` rápido e enfileirar `whatsapp.ingest` (pg-boss) com o
  payload + `org_id`.
- **Processamento (worker, em `withOrg(org_id)`)**:
  1. `parseInbound` → `NormalizedMessage`.
  2. **Idempotência**: inserir em `whatsapp_messages` com `ON CONFLICT (org_id, provider_msg_id) DO
     NOTHING`; se já existia, parar (FR-018, SC-006).
  3. **Associar/criar lead**: casar `remetente` (E.164) com `clientes (org_id, telefone)`; se novo,
     **criar lead** (origem "WhatsApp") respeitando `requireWithinLimit('clientes')`.
  4. **Enfileirar IA**: `ai.sentiment` (sempre, barato) e `ai.summarize` (quando a conversa acumula);
     se auto-atendimento ativo, `ai.autoreply`. Ver [ai-routing.md](ai-routing.md).

## Outbound (auto-atendimento)

- `sendMessage(org, to, content)` envia pela linha conectada; grava `whatsapp_messages` (`direcao='saida'`,
  `gerado_por_ia=true` quando vier da IA) e uma `interacao` no lead. Sujeito a regras de ativação/handoff
  (ver ai-routing). Rate limit por org para não disparar spam/ban.

## Segurança e invariantes

- Recurso **só VIP**; toda rota acima passa por `requirePlan('whatsapp_ia')`.
- Segredo de inbound por instância, guardado como hash, verificado em tempo constante (FR-029).
- **Idempotência** por `(org_id, provider_msg_id)`; mensagens duplicadas não duplicam registro.
- **Uma linha por org** (`UNIQUE(org_id)`); tentar uma segunda → erro ou substituição explícita.
- Mensagem sempre atribuída à **org correta** (resolvida pela instância) — nunca cross-tenant.
- Conexão/desconexão e troca de linha **auditadas** (`audit_log`).
- API não oficial: risco de ban assumido; instabilidade reflete em `estado=desconectado` sem perder
  mensagens já recebidas; reconexão possível. Mídia pode ser tratada como referência na v1 (texto
  primeiro).
