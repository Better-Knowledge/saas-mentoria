/*
 * Copyright 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
  {
    name: 'metricas',
    description:
      'Métricas consolidadas do negócio (mesma fonte da tela Dashboard). Retorna: '
      + '`kpis` (pipeline em aberto, pipeline ponderado pelo peso de cada etapa, taxa de vitória, '
      + 'ticket médio, ciclo médio em dias, receita ganha); '
      + '`serie` com os últimos 12 meses de ganhos/perdidos/novos leads; '
      + '`funil` com valor parado por etapa; `origens` ordenadas por valor ganho; `tipos`; '
      + '`autoria` (leads criados por humano x IA); e `atencao` com as listas acionáveis '
      + '(sem próxima ação agendada, parados há 30+ dias, propostas enviadas em aberto). '
      + 'Use para responder perguntas sobre desempenho, previsão de receita e o que precisa de follow-up.',
    inputSchema: {},
    annotations: { title: 'Métricas do negócio', readOnlyHint: true, openWorldHint: false },
    run: (crm) => crm.dashboard(),
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

  // ----- Resumo de reunião (feature 002) -----
  // Paridade com as rotas REST de contracts/rest-resumos.md. A validação autoritativa
  // acontece uma vez só, no crm-service, com o schema de ia/schema-resumo.js; a forma
  // declarada aqui existe para o agente descobrir o que enviar (research.md §2).
  {
    name: 'extrair_resumo_reuniao',
    description:
      'Extrai decisões, próximos passos e objeções de uma transcrição de reunião e devolve um '
      + 'rascunho para revisão. NÃO grava nada no histórico do cliente — para gravar, chame '
      + 'confirmar_resumo_reuniao. Cada chamada aciona um serviço externo de IA e tem custo.',
    inputSchema: {
      id: idCliente,
      transcricao: z.string().min(1).max(200000).describe('Texto da transcrição (≤ 200.000 caracteres)'),
    },
    annotations: {
      title: 'Extrair resumo de reunião',
      readOnlyHint: false, idempotentHint: false, destructiveHint: false,
      // Única ferramenta do catálogo que alcança um serviço externo — o agente merece saber.
      openWorldHint: true,
    },
    run: (crm, autor, { id, transcricao }, principal) =>
      crm.resumoReuniao.criarRascunho(id, transcricao, principal),
  },
  {
    name: 'obter_rascunho_resumo',
    description: 'Retorna um rascunho de resumo em revisão. Só o dono do rascunho o enxerga.',
    inputSchema: { id: z.number().int().positive().describe('ID do rascunho') },
    annotations: { title: 'Obter rascunho', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    run: (crm, autor, { id }, principal) => crm.resumoReuniao.obterRascunho(id, principal),
  },
  {
    name: 'confirmar_resumo_reuniao',
    description:
      'Grava o rascunho revisado como interação no histórico do cliente. QUANDO CHAMADA POR UMA '
      + 'CHAVE DE API, o registro é gravado como NÃO REVISADO POR HUMANO e assim aparece na ficha. '
      + 'Não altera nenhum campo de negócio do cliente: para mudar a próxima ação, use '
      + 'atualizar_cliente numa chamada separada.',
    inputSchema: {
      id: z.number().int().positive().describe('ID do rascunho'),
      resumo: z.string().max(2000).optional(),
      decisoes: z.array(z.object({ texto: z.string().min(1).max(500) })).optional(),
      proximos_passos: z.array(z.object({
        texto: z.string().min(1).max(500),
        responsavel: z.string().max(120).nullable().optional(),
        prazo: z.string().describe('Data YYYY-MM-DD').nullable().optional(),
      })).optional(),
      objecoes: z.array(z.object({ texto: z.string().min(1).max(500) })).optional(),
    },
    annotations: { title: 'Confirmar resumo', readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    run: (crm, autor, { id, ...revisado }, principal) =>
      crm.resumoReuniao.confirmarRascunho(id, revisado, principal),
  },
  {
    name: 'descartar_resumo_reuniao',
    description:
      'Descarta o rascunho permanentemente. IRREVERSÍVEL: a transcrição associada é apagada junto '
      + 'e a extração precisaria ser refeita, com novo custo.',
    inputSchema: { id: z.number().int().positive().describe('ID do rascunho') },
    annotations: { title: 'Descartar rascunho', readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    run: (crm, autor, { id }, principal) => crm.resumoReuniao.descartarRascunho(id, principal),
  },
  {
    name: 'obter_transcricao',
    description:
      'Retorna a transcrição de origem de um registro de reunião. Ela é retida por 90 dias; '
      + 'depois disso a resposta traz disponivel:false — o registro permanece, a fonte não.',
    inputSchema: { id: z.number().int().positive().describe('ID da interação') },
    annotations: { title: 'Obter transcrição', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    run: (crm, autor, { id }) => crm.resumoReuniao.obterTranscricao(id),
  },
];
