# Contract — Cobrança via pagar.me (Assinaturas + Webhooks)

**Feature**: `002-saas-multitenant`

Define o fluxo de assinatura, o tratamento de webhooks e o mapeamento estado→permissões. **Nenhum dado
de cartão trafega ou é armazenado no nosso servidor** (Princípio II / FR-007).

## Planos

| Código | Nome | Preço | `limite_clientes` | Features chave |
|---|---|---|---|---|
| `basico` | Básico | R$ 39,90/mês | 5.000 | Gordon, relatórios básicos |
| `intermediario` | Intermediário | R$ 69,90/mês | 50.000 (configurável) | + relatórios avançados, automações de funil |
| `vip` | VIP | R$ 299,90/mês | ilimitado | + WhatsApp com IA (resumo·sentimento·resposta), IA avançada |

O catálogo é **local** (tabela `plans`), espelhando os planos criados no pagar.me (`pagarme_plan_id`).

## Trial, meio de pagamento e retenção

- **Trial de 14 dias**: toda organização recém-criada começa em `trialing`, com **acesso pleno ao plano
  escolhido** e **sem cobrança**; `subscriptions.trial_end = signup + 14 dias`.
- **Somente cartão de crédito** (sem Pix/boleto na v1). O cartão pode ser adicionado durante o trial; a
  **1ª cobrança ocorre ao fim do trial**.
- **Fim do trial** (job `billing.trial_check`): com cartão válido → cria/ativa a assinatura no pagar.me e
  cobra (→ `active`); sem cartão / cobrança falha → suspenso.
- **Retenção de 90 dias**: orgs `canceled`/`unpaid` mantêm os dados por **90 dias** (export LGPD
  disponível); depois, um job de purga remove os dados da org. Reativação na janela restaura o acesso.

## Fluxo de assinatura

1. **Cartão tokenizado no cliente**: o front usa o SDK do pagar.me (`pagar.me.js`) ou o **checkout
   hospedado / Payment Link** do plano. O PAN nunca chega ao nosso backend; recebemos apenas um
   **token**/identificador.
2. **Criar/assinar (servidor)** `POST /api/billing/subscribe { plan_codigo, card_token }`:
   - garante um **Customer** no pagar.me para a org (cria na primeira vez);
   - cria a **Subscription** no plano correspondente (ciclo mensal) com o token;
   - grava `subscriptions` (org, plano, `pagarme_subscription_id`, status inicial).
3. **Confirmação** vem por **webhook** (não confiar na resposta síncrona para liberar acesso).
4. **Upgrade/downgrade** `POST /api/billing/change-plan { plan_codigo }`: altera a subscription no
   pagar.me; o webhook confirma; entitlements seguem o novo plano.
5. **Cancelamento** `POST /api/billing/cancel`: cancela no pagar.me; webhook confirma → `canceled`.
6. **Portal** `GET /api/billing` retorna estado atual (plano, status, período, próximo vencimento) para
   a UI.

> Alternativa de menor esforço de PCI: usar **Payment Link/checkout hospedado** por plano e apenas
> consumir os webhooks — sem manipular token no backend. A abstração `billing/pagarme.js` suporta os
> dois modos.

## Webhooks `POST /webhooks/pagarme`

- **Verificação de assinatura**: validar o cabeçalho de assinatura do pagar.me com `PAGARME_WEBHOOK_SECRET`
  em **tempo constante**; assinatura inválida → `401`, sem efeito (FR-029, SC-008).
- **Idempotência**: inserir em `billing_events` por `pagarme_event_id` com `ON CONFLICT DO NOTHING`; se
  já existe → `200` sem reprocessar (FR-008).
- **Padrão aceitar-e-enfileirar**: responder `2xx` rápido e enfileirar `billing.process_event` (pg-boss)
  para o processamento; reduz timeout e perda.

### Eventos tratados → transição de estado

| Evento (pagar.me) | Efeito em `subscriptions.status` | Entitlements |
|---|---|---|
| `subscription.created` / `subscription.activated` | `active` | acesso pleno do plano |
| `invoice.paid` / `charge.paid` | `active`; atualiza `current_period_end` | acesso pleno |
| `invoice.payment_failed` / `charge.payment_failed` | `past_due`; define `grace_until` | **carência** (acesso mantido até `grace_until`) |
| (carência esgotada — job) | `unpaid` | **suspenso** (somente leitura + billing) |
| `subscription.canceled` | `canceled` | **suspenso** |
| `subscription.updated` (troca de plano) | mantém `active`; troca `plan_id` | novo plano |

## Máquina de estados (resumo)

```text
[signup] --> trialing (14 dias, acesso pleno, sem cobrança)
   trialing --fim do trial + cartão ok--> active
   trialing --fim do trial sem cartão / falha--> unpaid (suspenso)
   active --payment_failed--> past_due (carência até grace_until)
   past_due --pago--> active
   past_due --grace expira (job)--> unpaid (suspenso)
   active/past_due/trialing --cancel--> canceled (suspenso)
   unpaid/canceled --novo pagamento/assinatura--> active
   unpaid/canceled --90 dias sem regularizar (job)--> purga (LGPD)
```

- **Carência** (`past_due` + `now() < grace_until`): acesso mantido (evita cortar cliente por falha
  transitória). Duração em config (ex.: 3–7 dias).
- **Suspenso** (`unpaid`/`canceled`): bloquear escritas de tenant (`402` `billing:true`); manter leitura
  e **export LGPD**; oferecer regularização/upgrade.

## Reconciliação

Job `billing.reconcile` (periódico): consulta o pagar.me as assinaturas da plataforma e corrige
divergências (ex.: webhook perdido), garantindo que o estado local convirja para o do provedor
(FR-011). Idempotente.

## Segurança e invariantes

- Sem PAN no servidor; só tokens/ids do pagar.me.
- Permissões derivam **só** do estado verificado localmente (alimentado por webhooks assinados +
  reconciliação) — nunca de input do cliente (Princípio VI, FR-009).
- Webhook não assinado/duplicado → sem efeito.
- Toda mudança de plano/estado é auditada (`audit_log`, `acao='plano_alterado'`).
- Preços/limx em config; mudança de preço não altera assinaturas vigentes sem evento correspondente.
