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
// audit.js — a trilha grava autoria verificada e recusa dado pessoal.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/app');
const audit = require('../audit');

after(() => h.limpar());

describe('autoria vem da credencial', () => {
  test('sessão grava humano/sessao; chave grava ia/apikey', () => {
    audit.registrar({ entidade: 'cliente', entidade_id: 1, acao: 'atualizar',
      campo: 'etapa', valor_anterior: 'novo', valor_novo: 'reuniao',
      principal: h.principalSessao(42) });
    audit.registrar({ entidade: 'cliente', entidade_id: 2, acao: 'criar',
      principal: h.principalChave(7) });
    const linhas = audit.listar();
    assert.equal(linhas[0].autor, 'humano');
    assert.equal(linhas[0].credencial, 'sessao');
    assert.equal(linhas[1].autor, 'ia');
    assert.equal(linhas[1].credencial, 'apikey');
    assert.equal(linhas[1].credencial_id, 7);
  });

  test('sem principal autenticado, falha fechada', () => {
    assert.throws(() => audit.registrar({ entidade: 'cliente', entidade_id: 1, acao: 'criar' }),
      /principal autenticado/);
    assert.throws(() => audit.registrar({ entidade: 'cliente', entidade_id: 1, acao: 'criar',
      principal: { tipo: 'humano' } }), /principal autenticado/);
  });
});

describe('a trilha não guarda dado pessoal (FR-022)', () => {
  test('campos sensíveis são substituídos por [omitido]', () => {
    for (const campo of ['texto', 'transcricao', 'resumo', 'telefone', 'email', 'senha']) {
      audit.registrar({ entidade: 'interacao', entidade_id: 99, acao: 'atualizar',
        campo, valor_anterior: 'CONTEUDO SENSIVEL', valor_novo: 'OUTRO CONTEUDO',
        principal: h.principalSessao() });
    }
    const linhas = audit.listar({ entidade: 'interacao', entidade_id: 99 });
    assert.equal(linhas.length, 6);
    for (const l of linhas) {
      assert.equal(l.valor_anterior, '[omitido]', `campo ${l.campo}`);
      assert.equal(l.valor_novo, '[omitido]', `campo ${l.campo}`);
    }
    assert.doesNotMatch(JSON.stringify(linhas), /CONTEUDO SENSIVEL/);
  });

  test('valores longos são truncados — a trilha guarda valor de campo, não documento', () => {
    audit.registrar({ entidade: 'cliente', entidade_id: 5, acao: 'atualizar',
      campo: 'proxima_acao', valor_novo: 'x'.repeat(5000), principal: h.principalSessao() });
    const l = audit.listar({ entidade: 'cliente', entidade_id: 5 })[0];
    assert.ok(l.valor_novo.length < 300);
  });
});
