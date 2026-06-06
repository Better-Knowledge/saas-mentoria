// mcp/tools.mjs — catálogo das ferramentas MCP (contrato em contracts/mcp-tools.md).
// Cada ferramenta declara: name, description, inputSchema (forma zod), annotations e run().
// `run(crm, autor, args)` chama a camada de serviço compartilhada (crm-service.js).
// IMPORTANTE (FR-008 / auditoria): nenhum inputSchema aceita `created_by`/`gerado_por_ia` —
// a autoria é sempre derivada da credencial autenticada (`autor`), nunca da entrada do agente.
import { z } from 'zod';

const idCliente = z.number().int().positive().describe('ID do cliente (clientes.id)');

// Campos de Cliente reaproveitados por criar/atualizar (whitelist espelha crm-service.montaCliente).
const camposCliente = {
  empresa: z.string().optional(),
  cargo: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().optional(),
  tipo_cliente: z.enum(['b2b', 'autonomo', 'publico']).optional(),
  origem: z.string().optional(),
  etapa: z.enum(['novo', 'qualificacao', 'reuniao', 'proposta']).optional(),
  resultado: z.enum(['em_aberto', 'ganho', 'perdido']).optional(),
  valor_estimado: z.number().nonnegative().optional(),
  proposta_enviada: z.boolean().optional(),
  status_pagamento: z.string().optional(),
  proxima_acao: z.string().optional(),
  proxima_acao_data: z.string().describe('Data YYYY-MM-DD').optional(),
};

export const TOOLS = [
  // ----- Leitura -----
  {
    name: 'listar_clientes',
    description: 'Lista todos os clientes/leads, com contagem de interações, mais recentes primeiro.',
    inputSchema: {},
    annotations: { title: 'Listar clientes', readOnlyHint: true, openWorldHint: false },
    run: (crm) => crm.listarClientes(),
  },
  {
    name: 'obter_cliente',
    description: 'Retorna a ficha completa de um cliente e seu histórico de interações.',
    inputSchema: { id: idCliente },
    annotations: { title: 'Obter cliente', readOnlyHint: true, openWorldHint: false },
    run: (crm, autor, { id }) => crm.obterCliente(id),
  },
  {
    name: 'acoes_hoje',
    description: 'Follow-ups classificados em atrasados, hoje e futuros (clientes em aberto com próxima ação datada).',
    inputSchema: {},
    annotations: { title: 'Ações de hoje', readOnlyHint: true, openWorldHint: false },
    run: (crm) => crm.acoesHoje(),
  },
  {
    name: 'listar_interacoes',
    description: 'Lista as interações (histórico) de um cliente, mais recentes primeiro.',
    inputSchema: { id: idCliente },
    annotations: { title: 'Listar interações', readOnlyHint: true, openWorldHint: false },
    run: (crm, autor, { id }) => crm.listarInteracoes(id),
  },

  // ----- Escrita (auditada como 'ia') -----
  {
    name: 'criar_cliente',
    description: 'Cria um lead/cliente. Apenas "nome" é obrigatório. O autor é gravado como IA.',
    inputSchema: { nome: z.string().min(1).describe('Nome do contato (obrigatório)'), ...camposCliente },
    annotations: { title: 'Criar cliente', readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    run: (crm, autor, args) => crm.criarCliente(args, autor),
  },
  {
    name: 'atualizar_cliente',
    description: 'Atualiza os dados de um cliente existente (merge sobre o registro atual).',
    inputSchema: { id: idCliente, nome: z.string().min(1).optional(), ...camposCliente },
    annotations: { title: 'Atualizar cliente', readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    run: (crm, autor, { id, ...resto }) => crm.atualizarCliente(id, resto),
  },
  {
    name: 'mover_etapa',
    description: 'Move o cliente no funil e/ou define o resultado (ganho/perdido). Informe ao menos um de etapa/resultado.',
    inputSchema: {
      id: idCliente,
      etapa: z.enum(['novo', 'qualificacao', 'reuniao', 'proposta']).optional(),
      resultado: z.enum(['em_aberto', 'ganho', 'perdido']).optional(),
    },
    annotations: { title: 'Mover etapa', readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    run: (crm, autor, { id, etapa, resultado }) => crm.moverEtapa(id, { etapa, resultado }),
  },
  {
    name: 'registrar_interacao',
    description: 'Adiciona uma anotação ao histórico de um cliente. Marcada como gerada por IA.',
    inputSchema: { id: idCliente, texto: z.string().min(1).max(5000).describe('Texto da anotação (≤ 5000)') },
    annotations: { title: 'Registrar interação', readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    run: (crm, autor, { id, texto }) => crm.registrarInteracao(id, texto, autor),
  },

  // ----- LGPD (paridade total — FR-013) -----
  {
    name: 'exportar_cliente',
    description: 'Exporta todos os dados de um cliente (ficha + interações) para portabilidade LGPD.',
    inputSchema: { id: idCliente },
    annotations: { title: 'Exportar cliente', readOnlyHint: true, openWorldHint: false },
    run: (crm, autor, { id }) => crm.exportarCliente(id),
  },
  {
    name: 'excluir_cliente',
    description: 'EXCLUI PERMANENTEMENTE um cliente e seu histórico (apagamento LGPD). Irreversível — confirme antes.',
    inputSchema: { id: idCliente },
    annotations: { title: 'Excluir cliente', readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    run: (crm, autor, { id }) => crm.excluirCliente(id),
  },
];
