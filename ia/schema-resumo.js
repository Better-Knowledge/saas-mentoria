// ia/schema-resumo.js — forma canônica do rascunho de reunião.
//
// Declarado em `zod/v4` porque é o que `zodOutputFormat` do SDK da Anthropic consome
// (o helper converte via zod/v4/core/to-json-schema; a API v3 falha ali). O projeto
// usa zod v3 no restante, inclusive nos inputSchema das ferramentas MCP — a decisão e
// o limite dessa duplicação estão em specs/002-resumo-reuniao-ia/research.md §2.
//
// Esta é a fonte única de (a) formato imposto ao modelo e (b) validação do corpo de
// confirmação. Nenhum campo de autoria ou de revisão existe aqui, de propósito:
// eles vêm sempre da credencial autenticada, nunca da entrada (FR-019, PRD RF-73).
const { z } = require('zod/v4');

const LIMITE_ITEM = 500;
const LIMITE_RESUMO = 2000;

// Data em YYYY-MM-DD. Mesmo formato que o restante do produto usa e valida.
const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em YYYY-MM-DD');

const item = z.object({
  texto: z.string().min(1).max(LIMITE_ITEM),
});

const proximoPasso = z.object({
  texto: z.string().min(1).max(LIMITE_ITEM),
  // Nulos são a resposta correta quando a transcrição não declara: o sistema não
  // inventa prazo nem responsável (FR-004). O prompt reforça, o schema permite.
  responsavel: z.string().max(120).nullable(),
  prazo: dataISO.nullable(),
});

// Forma que o MODELO devolve.
const SchemaExtracao = z.object({
  resumo: z.string().max(LIMITE_RESUMO),
  decisoes: z.array(item),
  proximos_passos: z.array(proximoPasso),
  objecoes: z.array(item),
  sugestao_proxima_acao: z.object({
    texto: z.string().max(LIMITE_ITEM).nullable(),
    data: dataISO.nullable(),
  }).nullable(),
});

// Forma que a PESSOA (ou o agente) devolve ao confirmar. Difere da de cima em um
// ponto: `promover_proxima_acao` é uma decisão humana, não algo que o modelo produz.
const SchemaConfirmacao = z.object({
  resumo: z.string().max(LIMITE_RESUMO).default(''),
  decisoes: z.array(item).default([]),
  proximos_passos: z.array(proximoPasso).default([]),
  objecoes: z.array(item).default([]),
  promover_proxima_acao: z.object({
    texto: z.string().min(1).max(LIMITE_ITEM),
    data: dataISO,
    substituir: z.boolean().optional(),
  }).nullish(),
});

module.exports = { SchemaExtracao, SchemaConfirmacao, LIMITE_ITEM, LIMITE_RESUMO, dataISO };
