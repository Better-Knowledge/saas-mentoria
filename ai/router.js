// ai/router.js — escolha do modelo Claude por tarefa (Princípio VII). IDs vêm da config (.env),
// trocáveis sem mexer na lógica. O barato resolve as tarefas simples; o capaz só onde precisa.
const HAIKU = process.env.CLAUDE_MODEL_HAIKU || 'claude-haiku-4-5';
const SONNET = process.env.CLAUDE_MODEL_SONNET || 'claude-sonnet-4-6';
const OPUS = process.env.CLAUDE_MODEL_OPUS || 'claude-opus-4-8';

const MAPA = {
  // volume alto / baixa complexidade → Haiku
  sentimento: HAIKU,
  triagem: HAIKU,
  extracao_lead: HAIKU,
  // equilíbrio qualidade/custo → Sonnet
  resumo: SONNET,
  gordon: SONNET,
  auto_resposta: SONNET,
  relatorio: SONNET,
  // raciocínio complexo / escalado → Opus
  raciocinio_complexo: OPUS,
};

function modeloParaTarefa(tarefa) {
  return MAPA[tarefa] || SONNET;
}

module.exports = { HAIKU, SONNET, OPUS, modeloParaTarefa };
