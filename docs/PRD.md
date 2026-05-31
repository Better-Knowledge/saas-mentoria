# PRD — Mini CRM sob medida (Consultoria & IA Generativa)

> **Autor:** Farley (Consultor, Professor e Desenvolvedor de soluções em IA Generativa)
> **Data:** 31/05/2026

---

## Contexto (por que estamos fazendo isso)

Você atende **empresas (B2B), profissionais autônomos e setor público/instituições**, vendendo
**consultoria/projetos, cursos e mentorias, desenvolvimento de soluções e palestras/workshops**.

Hoje seus contatos chegam e são organizados principalmente via **WhatsApp e redes sociais** — sem um
lugar único. O resultado é que você perde dinheiro por **follow-ups esquecidos, perda de histórico,
falta de visão do status de cada cliente e propostas que ficam sem retorno**.

O objetivo é ter um **Mini CRM simples, sob medida**, que centralize seus clientes, mostre claramente
em que etapa cada um está, e principalmente **nunca deixe um follow-up cair no esquecimento**. Como
você trabalha sozinho mas quer **integrar IA/automações**, o sistema precisa ser pensado para que
agentes de IA também consigam ler e escrever nele.

---

## 1. Problema e Objetivo

**Problema:** contatos espalhados entre WhatsApp e redes sociais, sem histórico nem controle de etapas,
fazendo você perder vendas por falta de acompanhamento.

**Objetivo:** centralizar clientes em um só lugar, dar visão clara do funil e garantir que todo
follow-up tenha data e lembrete — começando pelo mínimo possível para já gerar valor.

**Como vamos saber que deu certo (metas simples):**
- Zero follow-ups "perdidos": todo cliente ativo tem uma próxima ação com data.
- 100% das propostas enviadas têm status atualizado (aguardando / ganho / perdido).
- Histórico completo de cada cliente acessível em segundos.

---

## 2. Usuários e o que cada um faz

| Usuário | O que faz |
|---|---|
| **Você (dono/admin)** | Cadastra clientes, move pelo funil, registra conversas, envia propostas, vê a tela "Hoje" e fecha negócios. Único usuário humano por enquanto. |
| **Agentes de IA / automações** | Leem e escrevem no CRM via API: criam leads que chegam do WhatsApp/redes, registram resumos de conversa, sugerem próximos follow-ups e atualizam status. Tudo com permissão controlada e registro de quem fez o quê. |

> **Decisão de projeto:** desde o MVP o banco de dados e uma API simples devem existir para que a IA
> consiga operar. A interface é para você; a API é para a IA.

---

## 3. Funcionalidades

### Essenciais (MVP — o mínimo que já resolve sua dor)
1. **Cadastro de cliente** com: contato + empresa (nome, empresa, cargo, telefone/WhatsApp, e-mail),
   **origem do lead** (indicação, Instagram, LinkedIn, evento…) e tipo de cliente (B2B / autônomo / público).
2. **Funil visual (Kanban)** com 4 etapas: **Novo contato → Qualificação → Reunião/Diagnóstico → Proposta + Fechamento** (com saída Ganho/Perdido).
3. **Histórico de interações**: anotações livres com data por cliente (conversas, reuniões).
4. **Negócio/Proposta**: valor estimado, proposta enviada (sim/não), status de pagamento.
5. **Próxima ação + data** em cada cliente (o coração do anti-esquecimento).
6. **Tela "Hoje"**: lista do que precisa ser feito hoje e o que está atrasado.
7. **API básica** para a IA criar/ler/atualizar clientes e interações.

### Desejáveis (depois do MVP)
- Captura automática de leads do **WhatsApp** e redes sociais.
- Lembretes saindo para **WhatsApp, e-mail e Google Agenda** (no MVP, lembrete vive na tela "Hoje").
- Resumos automáticos de conversa gerados por IA.
- Relatórios simples: taxa de conversão por etapa, por origem e por tipo de oferta.
- Modelos de proposta e disparo com 1 clique.
- Multiusuário (assistente/equipe) com permissões.

---

## 4. Como cada tela funciona (linguagem simples)

1. **Tela "Hoje" (abertura)** — primeira coisa que você vê. Mostra "Para fazer hoje" e "Atrasados":
   cada item é um cliente com a próxima ação. Clicou, abre o cliente e marca como feito.
2. **Funil (Kanban)** — quadro com 4 colunas (as etapas). Cada cliente é um cartãozinho com nome,
   empresa e valor. Você **arrasta** o cartão de uma coluna para a outra conforme avança.
3. **Ficha do cliente** — abre ao clicar num cartão. Tem três blocos: (a) dados de contato e origem;
   (b) histórico de interações em ordem de data, com botão "+ Anotação"; (c) negócio (valor, proposta,
   status) e o campo "Próxima ação + data".
4. **Novo cliente** — formulário curto: contato, empresa, origem, tipo, etapa inicial. Salvou, vira
   cartão em "Novo contato".
5. **(Desejável) Painel** — números simples: quantos em cada etapa, conversão, origem que mais traz cliente.

---

## 5. Privacidade e LGPD

Você lida com **dados pessoais** (nome, telefone, e-mail) e, no setor público, possivelmente
**dados de agentes públicos** — então a LGPD se aplica.

**Dados sensíveis / que exigem cuidado extra:**
- Contato pessoal (telefone/WhatsApp, e-mail) — pessoais.
- Conteúdo das conversas/anotações — pode conter informação confidencial do negócio do cliente.
- Valores de propostas e dados financeiros — sigilo comercial.
- Qualquer dado de cliente do setor público — atenção redobrada.

**Como proteger (regras do produto):**
1. **Base legal e finalidade:** guardar só o necessário para a relação comercial; registrar a origem
   do contato (consentimento/indicação/relação contratual).
2. **Acesso controlado:** login com senha forte; a API da IA usa chave/token próprio, com permissão
   mínima e possibilidade de revogar.
3. **Registro de atividades (auditoria):** gravar quem (você ou qual agente de IA) criou/alterou cada
   registro e quando.
4. **Criptografia:** dados protegidos em trânsito (HTTPS) e backup criptografado.
5. **Direitos do titular:** poder **exportar** e **excluir** todos os dados de um cliente sob pedido.
6. **Retenção:** definir prazo para apagar leads frios/perdidos antigos.
7. **IA com cautela:** ao enviar conversas para um modelo de IA, evitar dados desnecessários e usar
   provedores que não treinem com seus dados; deixar claro no histórico quando um texto foi gerado por IA.
