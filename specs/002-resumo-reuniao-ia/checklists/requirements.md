# Specification Quality Checklist: Resumo automático de reunião com revisão humana

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-23
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Iteração 1 (2026-08-23).** Todos os itens passam exceto três marcadores de clarificação
  (FR-026 destino da transcrição, FR-027 onde a extração acontece, FR-028 exposição a máquinas).
- **Iteração 2 (2026-08-23).** As três perguntas foram respondidas pelo responsável pelo produto
  (Q1 → A, Q2 → C com retenção de 90 dias e transcrição fora da exportação do titular, Q3 → C).
  Os marcadores foram substituídos por requisitos concretos e a spec revalidada: **todos os itens
  passam**.

### Pontos que o planejamento precisa carregar

Nenhum destes bloqueia a spec, mas os três exigem decisão registrada no plano:

1. **Dependência externa (FR-027).** É a primeira dependência de terceiro do produto, com custo por
   uso e segredo a guardar. O Princípio VI da constituição exige justificativa escrita na Complexity
   Tracking, e o Princípio I exige que a credencial nunca alcance o navegador (FR-027a).
2. **Retenção de 90 dias com transcrição fora da exportação (FR-026 a FR-026d).** Decisão explícita
   do responsável. A tensão está registrada na seção Assumptions da spec: por 90 dias existe dado do
   titular no sistema que a exportação não entrega. A revisão de segurança da fase deve registrar a
   justificativa em `SEGURANCA.md`.
3. **Confirmação por máquina sem revisão humana (FR-028 a FR-028c).** Decisão explícita do
   responsável, adotada com controle compensatório — registro marcado como não revisado, na ficha e
   na auditoria. Contraria a regra de F2.1 do `ROADMAP.md`, que precisa ser atualizada para não
   ficar em contradição com a spec aprovada.

### Conformidade com a constituição v2.0.0

| Princípio | Onde a spec responde |
|---|---|
| I — Segurança e Privacidade por Padrão | FR-005 (minimização), FR-023 (texto puro), FR-024 (credencial obrigatória), FR-025 (rascunho por sessão), FR-026a/b (descarte), FR-027a (segredo só no servidor) |
| II — Dois Planos de Credencial | FR-007 (plano humano) e FR-028 (plano de máquina), tratados separadamente |
| III — Auditoria Confiável e Autenticada | FR-019 a FR-022, FR-028b |
| IV — Reuso Antes de Reescrita | Assumptions: histórico de interações, marcação humano×IA, próxima ação e trilha de auditoria são reaproveitados, não recriados |
| V — Camada de Domínio Única e Paridade | FR-028 mantém a paridade REST↔MCP; FR-028c mantém a mesma regra de negócio nos dois caminhos |
| VI — Simplicidade Sob Medida | Dependencies: a dependência externa exige justificativa registrada |
| VII — Documentação como Contrato Vivo | `ROADMAP.md` F2.1 e `PRD-Reconstrucao-CRM.md` §4.2 precisam ser atualizados na mesma leva da implementação |
