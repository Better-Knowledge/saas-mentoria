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
