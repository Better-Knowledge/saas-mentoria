# Implementation Plan: Servidor MCP Autenticado para Acesso de Agentes

**Branch**: `001-mcp-server-auth` | **Date**: 2026-06-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-mcp-server-auth/spec.md`

## Summary

Expor as capacidades do CRM a agentes de IA remotos por meio de um **servidor MCP** montado no
mesmo processo Express, em um único endpoint `POST /mcp` usando o transporte **Streamable HTTP**.
O endpoint é protegido por um middleware de autenticação **Bearer** que reaproveita o plano de
**chaves de API por integração** já existente (`auth.verificarApiKey`), com a camada de auth
desenhada por trás de uma abstração que permite acrescentar OAuth do MCP no futuro (decisão híbrida,
FR-014). As 10 ferramentas MCP mapeiam 1:1 para as operações já existentes do CRM — com **paridade
total**, incluindo exportar e excluir (FR-013) — chamando uma fina **camada de serviço compartilhada**
(`crm-service.js`) que tanto as rotas REST quanto as ferramentas MCP usam, evitando divergência de
comportamento. A autoria de toda escrita continua **derivada da credencial** (`created_by = 'ia'`),
nunca de entrada do cliente (FR-008).

## Technical Context

**Language/Version**: Node.js 20 LTS (mínimo 18), JavaScript CommonJS (`type: commonjs`).

**Primary Dependencies**: Express 4 (existente), **`@modelcontextprotocol/sdk` (NOVA)** para o
servidor MCP + transporte Streamable HTTP, `better-sqlite3` (existente), `helmet` +
`express-rate-limit` (existentes), `bcryptjs` / `crypto` (existentes, plano de credenciais).

**Storage**: SQLite via `better-sqlite3` (arquivo `crm.db` existente). **Sem mudança de schema na
v1** — as credenciais de agente reaproveitam a tabela `api_keys`; clientes/interações usam as
tabelas atuais.

**Testing**: Verificação manual conforme `quickstart.md` — MCP Inspector e/ou chamadas JSON-RPC via
`curl` (initialize → tools/list → tools/call), cobrindo auth, auditoria e revogação. O projeto não
adota framework de testes automatizados; a constituição exige verificação manual antes de concluir.

**Target Platform**: Servidor Linux em container Docker atrás do Traefik (rede `web`), TLS terminado
no proxy. `NODE_ENV=production` ativa cookies `Secure` + HSTS.

**Project Type**: Web service de projeto único (backend Express + frontend estático em `public/`).

**Performance Goals**: Uso individual / poucos agentes; alvo p95 < 500 ms por chamada de ferramenta
sob carga típica. Não há requisito de alta concorrência.

**Constraints**: Reutilizar a infraestrutura de auth e auditoria existentes; mesmo processo e mesmo
deploy (Simplicidade); alcançável remotamente com transporte criptografado em produção; nenhuma
credencial de máquina no navegador.

**Scale/Scope**: Dono único, poucas integrações de IA, na ordem de centenas–milhares de clientes;
10 ferramentas MCP mapeadas para os endpoints existentes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Status |
|---|---|---|
| **I. Simplicidade Sob Medida** | MCP no mesmo processo Express; sem novo banco; sem mudança de schema; frontend vanilla intacto. Única dependência nova é o SDK MCP — justificada: implementar o protocolo JSON-RPC/MCP à mão seria muito mais complexo e frágil. | ✅ PASS |
| **II. Segurança e Privacidade por Padrão** | `/mcp` exige Bearer válido (sem modo aberto → 401); `helmet` e rate limit aplicados; TLS em produção via Traefik; segredo só como hash (reuso de `api_keys.key_hash`); limite de payload. | ✅ PASS |
| **III. Interface Dupla — Pessoas e IA** | MCP é o plano de "máquina": chaves Bearer por integração, revogáveis; nunca no navegador; sessão de usuário permanece separada. | ✅ PASS |
| **IV. Auditoria Confiável e Autenticada** | Toda escrita via MCP grava `created_by='ia'`/`gerado_por_ia=1` derivado da credencial autenticada; `ultimo_uso` da chave é atualizado. | ✅ PASS |
| **V. Documentação como Contrato Vivo** | Catálogo de ferramentas MCP é autodescritivo (inputSchema) e documentado em `contracts/`; README e docs serão atualizados; `openapi.yaml` segue valendo para a API REST. | ✅ PASS |

**Restrições de stack (Seção 2 da constituição):** mantidas (Node+Express, SQLite, helmet,
rate-limit, env, Docker/Traefik). Nenhum item da stack é substituído — apenas adicionada a
dependência do SDK MCP. **Sem violações → Complexity Tracking vazio.**

**Re-avaliação pós-design (após Fase 1):** os artefatos de design não introduzem violações. A
extração para `crm-service.js` reforça o Princípio V (um único comportamento para REST e MCP); o
reuso de `api_keys` mantém o Princípio III; a auditoria derivada da credencial nos schemas confirma o
Princípio IV; nenhuma mudança de schema preserva o Princípio I. **Constitution Check: PASS (mantido).**

## Project Structure

### Documentation (this feature)

```text
specs/001-mcp-server-auth/
├── plan.md              # Este arquivo (/speckit-plan)
├── research.md          # Fase 0 — decisões técnicas
├── data-model.md        # Fase 1 — entidades reaproveitadas + schemas de ferramenta
├── quickstart.md        # Fase 1 — guia de validação manual
├── contracts/
│   ├── mcp-tools.md     # Catálogo das 10 ferramentas MCP (contrato)
│   └── mcp-auth.md      # Contrato de autenticação Bearer do endpoint /mcp
├── checklists/
│   └── requirements.md  # Checklist de qualidade do spec (já criado)
└── tasks.md             # Fase 2 — (/speckit-tasks, NÃO criado aqui)
```

### Source Code (repository root)

```text
crm-mentoria/
├── server.js            # ALTERADO: bootstrap async; monta o endpoint /mcp e o middleware Bearer
├── auth.js              # ALTERADO (mínimo): expõe um requireBearer p/ MCP reusando verificarApiKey
├── db.js                # SEM MUDANÇA (reutiliza tabelas atuais)
├── crm-service.js       # NOVO: camada de serviço compartilhada (clientes/interações/hoje)
│                        #       usada pelas rotas REST e pelas ferramentas MCP
├── mcp/
│   ├── server.mjs       # NOVO (ESM): cria o McpServer, registra as 10 ferramentas,
│   │                    #             devolve um handler de transporte Streamable HTTP
│   └── tools.mjs        # NOVO (ESM): definição/descrição + inputSchema de cada ferramenta
├── public/              # SEM MUDANÇA (frontend vanilla)
├── openapi.yaml         # SEM MUDANÇA estrutural (REST); nota sobre o MCP no README
├── docs/                # ATUALIZADO: nova página descrevendo o acesso via MCP
├── Dockerfile / docker-compose.yml  # SEM MUDANÇA (mesmo processo/porta)
└── package.json         # ALTERADO: + dependência @modelcontextprotocol/sdk
```

**Structure Decision**: Projeto único, mesmo processo. A lógica de negócio das rotas é extraída para
`crm-service.js` para que REST e MCP compartilhem exatamente o mesmo comportamento e validação
(Princípio V). O código MCP fica em `mcp/*.mjs` (ESM, pois o SDK é ESM) e é carregado a partir do
`server.js` (CommonJS) via `import()` dinâmico no bootstrap — ver `research.md`. O endpoint `/mcp`
entra no mesmo app Express, herdando deploy, TLS (Traefik), `helmet` e rate limiting.

## Complexity Tracking

> Sem violações da constituição. Nada a justificar.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
