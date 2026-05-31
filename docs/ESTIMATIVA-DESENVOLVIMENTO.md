# Estimativa de Esforço — Mini CRM por uma Fábrica de Software tradicional

> Data: 31/05/2026 · Contexto: mercado brasileiro · Valores em R$ (referência 2026)
> Objetivo: estimar custo, homem-hora, equipe ideal e prazo para construir uma aplicação como esta
> por uma equipe tradicional de fábrica de software.

## Premissas
- Escopo: o CRM do PRD **em nível de produção** — com a autenticação correta e as correções de segurança
  apontadas em [SEGURANCA.md](SEGURANCA.md), testes, deploy e conformidade LGPD.
- Stack equivalente: API Node/Express (ou similar), front SPA (React), banco gerenciado (Postgres).
- Modelo: squad pequeno, metodologia ágil (sprints de 2 semanas).
- Estimativas em faixa (otimista–provável) por se tratar de projeto pequeno e bem definido.

---

## 1. Dois cenários

| Cenário | O que entrega | Homem-hora | Prazo | Custo aprox. |
|---|---|---|---|---|
| **A. Protótipo/MVP funcional** | O que já foi construído nesta sessão: CRUD, funil, tela Hoje, sem auth robusta | **150–200 h** | 3–4 semanas | **R$ 25k–40k** |
| **B. Produto em produção** | MVP + auth real (usuário + API keys), segurança, testes, deploy, LGPD, monitoramento | **700–900 h** | **2,5–3 meses** | **R$ 110k–180k** |

> O detalhamento abaixo é do **Cenário B** (produção), que é o que uma fábrica entregaria como "aplicação pronta".

---

## 2. Homem-hora por disciplina (Cenário B)

| Frente | Atividades | Horas |
|---|---|---|
| **Discovery / Requisitos** | Refinar PRD, histórias de usuário, critérios de aceite | 32 |
| **UX/UI Design** | Wireframes, design system em Figma, protótipo navegável | 50 |
| **Arquitetura & Setup** | Repositório, ambientes, CI/CD, padrões | 28 |
| **Backend** | Modelagem; CRUD clientes/interações; funil + Hoje; **auth de usuário (login/sessão/RBAC)**; **API keys**; export/delete + auditoria LGPD; hardening (helmet, rate limit, validação) | 200 |
| **Frontend** | Design system em código; tela Hoje; **Funil Kanban (drag-drop)**; Clientes + ficha + formulários; tela de login + gestão de API keys; integração/erros; responsivo + acessibilidade | 208 |
| **QA / Testes** | Unitários + integração (back); E2E (front); regressão manual; teste de segurança | 120 |
| **DevOps / Deploy** | Infra, banco gerenciado, CI/CD, monitoramento, backup | 40 |
| **Documentação & Handover** | Docs técnicas, manual, treinamento | 24 |
| **Gestão de Projeto** | Cerimônias, acompanhamento (~12%) | 85 |
| **TOTAL** | | **≈ 787 h** |

Arredondando incertezas: **700–900 homem-hora**.

---

## 3. Equipe ideal (squad)

| Papel | Alocação | Responsabilidade |
|---|---|---|
| Tech Lead / Arquiteto | meio período | Decisões técnicas, code review, segurança |
| Dev Backend (Pleno/Sênior) | integral | API, auth, banco, integrações |
| Dev Frontend (Pleno) | integral | SPA, Kanban, telas |
| UX/UI Designer | meio período | Design system, protótipo, usabilidade |
| QA / Tester | meio período | Testes automatizados e manuais |
| PO / Gerente de Projeto | meio período | Backlog, prazos, comunicação |
| DevOps | pontual/compartilhado | Infra, CI/CD, deploy |

**Equivalente:** ~**3 a 4 pessoas em tempo integral (FTE)** ao longo do projeto.

---

## 4. Custo — como se forma

Faixas de **valor-hora** praticadas por fábricas no Brasil (2026):

| Perfil | R$/hora |
|---|---|
| Júnior | 80–120 |
| Pleno | 120–200 |
| Sênior / Tech Lead | 200–350 |
| UX/UI Designer | 120–200 |
| QA | 100–160 |
| PO / PM | 150–250 |
| DevOps | 180–300 |

**Valor-hora médio ponderado (blended):** ~R$ 150–180/h.

- **Custo de produção (B):** 787 h × R$ 150–180 ≈ **R$ 118k–142k**.
  Com margem da fábrica e variação de senioridade: faixa **R$ 110k–180k**.
- **Custo do protótipo (A):** ~175 h × R$ 150 ≈ **R$ 26k** (faixa R$ 18k–40k).

> Modelos comerciais: **preço fechado** (fábrica assume o risco, embute margem maior) ou
> **homem-hora/alocação** (cliente paga horas reais). Para escopo bem definido como este, preço fechado é comum.

---

## 5. Cronograma macro (Cenário B)

| Fase | Duração |
|---|---|
| Discovery + Design | Semanas 1–2 |
| Setup + Backend núcleo (CRUD/funil) | Semanas 2–4 |
| Autenticação + Segurança | Semanas 4–6 |
| Frontend (telas + Kanban) | Semanas 4–8 |
| QA + Testes de segurança | Semanas 7–10 |
| Deploy + Homologação + Handover | Semanas 10–12 |

**Total:** ~**12 semanas (3 meses)**.

---

## 6. Riscos e fatores que mudam a conta
- **Multiusuário/multi-empresa (multi-tenant):** +30–50% no backend.
- **Integrações reais** (WhatsApp Business API, e-mail, Google Agenda): +40–120 h por integração.
- **Relatórios/dashboards** avançados: +60–100 h.
- **Conformidade LGPD formal** (DPO, política, RIPD): custo jurídico à parte.
- **Manutenção evolutiva:** ~15–20% do custo de build por ano.

---

## 7. Observação relevante para o seu negócio (IA Generativa)

O **protótipo funcional do Cenário A** — que uma fábrica estimaria em **3–4 semanas e ~R$ 25k–40k** —
foi construído **nesta sessão, em horas, com desenvolvimento assistido por IA**, incluindo dados de
mockup e o redesign no seu design system.

Isso ilustra o ponto central do seu trabalho: a IA não elimina a engenharia (a fase de **produção**
— segurança, auth, testes, deploy — continua exigindo equipe e disciplina), mas **comprime
drasticamente o caminho do zero ao protótipo validável**, reduzindo custo e tempo de descoberta.
O valor migra de "escrever código" para "definir o produto certo e endurecê-lo para produção".
