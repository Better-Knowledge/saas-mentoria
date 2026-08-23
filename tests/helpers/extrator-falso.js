/*
 * Mini CRM — Consultoria & IA Generativa
 * Copyright (c) 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licenciado sob a licença MIT. O texto completo está em LICENSE, na raiz do projeto.
 * SPDX-License-Identifier: MIT
 */
// tests/helpers/extrator-falso.js — dublê determinístico do serviço de IA.
//
// Nenhum teste chama a API de verdade: seria lento, não determinístico e cobraria.
// A injeção é de uma linha (crm-service.criarRascunho recebe o extrator por
// parâmetro, com o real como padrão), então não há framework de mock envolvido.
const { mascarar } = require('../../ia/extrator');

// Extrator que devolve sempre o mesmo rascunho.
function extratorFixo(rascunho = {}, extras = {}) {
  const chamadas = [];
  return {
    chamadas,
    async extrair(transcricao, opcoes) {
      chamadas.push({ transcricao, opcoes, enviado: mascarar(transcricao) });
      return {
        rascunho: {
          resumo: 'Resumo de teste.',
          decisoes: [{ texto: 'Fechar o diagnóstico' }],
          proximos_passos: [{ texto: 'Enviar proposta', responsavel: null, prazo: null }],
          objecoes: [{ texto: 'Achou o prazo curto' }],
          sugestao_proxima_acao: null,
          ...rascunho,
        },
        modelo: 'modelo-de-teste',
        tokens_entrada: 1234,
        tokens_saida: 56,
        duracao_ms: 1200,
        ...extras,
      };
    },
  };
}

// Extrator que sempre falha, para exercitar o caminho de indisponibilidade.
function extratorQuebrado(erro) {
  return {
    async extrair() {
      throw erro || Object.assign(
        new Error('Serviço de IA indisponível no momento. Nada foi gravado.'),
        { name: 'ErroIa', status: 503, configurado: true },
      );
    },
  };
}

module.exports = { extratorFixo, extratorQuebrado };
