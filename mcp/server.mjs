/*
 * Mini CRM — Consultoria & IA Generativa
 * Copyright (c) 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licenciado sob a licença MIT. O texto completo está em LICENSE, na raiz do projeto.
 * SPDX-License-Identifier: MIT
 */
// mcp/server.mjs — servidor MCP (ESM) montado sobre o Express via transporte Streamable HTTP.
// Carregado a partir do server.js (CommonJS) por import() dinâmico no bootstrap.
//
// Modelo stateless: cada requisição cria um McpServer próprio, "fechado" sobre o principal
// autenticado da requisição (req.principal). Assim, a autoria de toda escrita é DERIVADA DA
// CREDENCIAL (máquina → 'ia'), nunca de entrada do agente (FR-008 / Princípio IV).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOLS } from './tools.mjs';

// Registra as ferramentas em um McpServer, ligando cada uma ao crm-service e ao `autor` da requisição.
function registrarFerramentas(server, crmService, autor, principal) {
  for (const t of TOOLS) {
    const config = { description: t.description, annotations: t.annotations };
    // SDK aceita inputSchema como forma zod; omitimos quando a ferramenta não tem parâmetros.
    if (t.inputSchema && Object.keys(t.inputSchema).length > 0) {
      config.inputSchema = t.inputSchema;
    }
    server.registerTool(t.name, config, async (args) => {
      try {
        const resultado = await t.run(crmService, autor, args || {}, principal);
        return { content: [{ type: 'text', text: JSON.stringify(resultado, null, 2) }] };
      } catch (e) {
        // Erros de domínio (400/404) e quaisquer outros viram erro de ferramenta — sem 500 e sem
        // gravação parcial (a validação ocorre antes da escrita no crm-service).
        return { content: [{ type: 'text', text: e && e.message ? e.message : 'Erro' }], isError: true };
      }
    });
  }
}

// Fábrica: recebe as dependências (crm-service) e devolve um handler Express para POST /mcp.
// `req.principal` já foi populado pelo middleware requireBearer (auth.js).
export function criarHandlerMcp({ crmService }) {
  return async function handlerMcp(req, res) {
    const autor = req.principal && req.principal.tipo === 'ia' ? 'ia' : 'humano';
    const server = new McpServer({ name: 'mini-crm', version: '1.0.0' });
    // O principal inteiro é repassado às ferramentas: a posse do rascunho e a marca de
    // revisão saem da credencial verificada, nunca da entrada do agente.
    registrarFerramentas(server, crmService, autor, req.principal);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,   // stateless
      enableJsonResponse: true,        // resposta JSON (sem stream SSE)
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('Erro no MCP:', e && e.message ? e.message : e);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Erro interno do servidor MCP' },
          id: null,
        });
      }
    }
  };
}
