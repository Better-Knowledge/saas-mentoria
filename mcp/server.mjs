// mcp/server.mjs — servidor MCP (ESM) montado sobre o Express via transporte Streamable HTTP.
// Carregado a partir do server.js (CommonJS) por import() dinâmico no bootstrap.
//
// Multi-tenant: cada requisição traz `req.principal` (chave Bearer) com `org_id`. Cada ferramenta
// executa DENTRO de withOrg(org_id, …) — o RLS isola a organização da credencial. A autoria de toda
// escrita é derivada da credencial (máquina → 'ia'), nunca da entrada do agente (Princípio IV/V).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOLS } from './tools.mjs';

function registrarFerramentas(server, crmService, withOrg, orgId, autor) {
  for (const t of TOOLS) {
    const config = { description: t.description, annotations: t.annotations };
    if (t.inputSchema && Object.keys(t.inputSchema).length > 0) {
      config.inputSchema = t.inputSchema;
    }
    server.registerTool(t.name, config, async (args) => {
      try {
        // withOrg abre a transação e aplica o contexto da organização; a ferramenta recebe o client.
        const resultado = await withOrg(orgId, (client) => t.run(client, crmService, autor, args || {}));
        return { content: [{ type: 'text', text: JSON.stringify(resultado, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: e && e.message ? e.message : 'Erro' }], isError: true };
      }
    });
  }
}

// Fábrica: recebe crm-service + withOrg; devolve um handler Express para POST /mcp.
// `req.principal` já foi populado por requireBearer (auth.js) e carrega o org_id da credencial.
export function criarHandlerMcp({ crmService, withOrg }) {
  return async function handlerMcp(req, res) {
    const principal = req.principal || {};
    const autor = principal.tipo === 'ia' ? 'ia' : 'humano';
    const orgId = principal.org_id;
    const server = new McpServer({ name: 'saas-mentoria', version: '2.0.0' });
    registrarFerramentas(server, crmService, withOrg, orgId, autor);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,   // stateless
      enableJsonResponse: true,        // resposta JSON (sem stream SSE)
    });
    res.on('close', () => { transport.close(); server.close(); });

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
