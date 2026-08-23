/*
 * Mini CRM — Consultoria & IA Generativa
 * Copyright (c) 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licenciado sob a licença MIT. O texto completo está em LICENSE, na raiz do projeto.
 * SPDX-License-Identifier: MIT
 */
// Guarda de regressão da CSP e da ausência de handlers inline (Constitution I / RNF-16).
//
// Estes dois fatos se sustentam mutuamente: a CSP só pode dispensar 'unsafe-inline'
// enquanto o front não tiver um único handler em atributo. Se alguém acrescentar um
// `onclick`, ele simplesmente não funciona no navegador — e este teste diz por quê,
// em vez de deixar a pessoa depurando um botão morto.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/app');

const PUBLIC = path.join(__dirname, '..', 'public');
let app;

before(async () => { app = await h.app(); });
after(() => h.limpar());

describe('CSP sem unsafe-inline (Constitution I)', () => {
  test('o cabeçalho servido traz script-src \'self\' e script-src-attr \'none\'', async () => {
    const r = await h.request(app).get('/').expect(200);
    const csp = r.headers['content-security-policy'];
    assert.ok(csp, 'a CSP precisa ser enviada');
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/,
      "script-src não pode voltar a aceitar 'unsafe-inline'");
    assert.match(csp, /script-src-attr 'none'/,
      "script-src-attr 'none' é o que bloqueia onclick e afins");
  });
});

describe('nenhum handler inline no front (RNF-16)', () => {
  const ATRIBUTOS = /\son(?:click|change|input|submit|load|error|focus|blur|key\w+|drag\w*|drop|mouse\w+)\s*=/i;

  for (const arquivo of ['app.js', 'index.html']) {
    test(`${arquivo} não contém handler em atributo`, () => {
      const conteudo = fs.readFileSync(path.join(PUBLIC, arquivo), 'utf8');
      const achados = conteudo.split('\n')
        .map((linha, i) => (ATRIBUTOS.test(linha) ? `${arquivo}:${i + 1}: ${linha.trim().slice(0, 80)}` : null))
        .filter(Boolean);
      assert.deepEqual(achados, [],
        'use delegação de eventos com data-* — handler em atributo quebra sob a CSP');
    });
  }

  test('as ações da interface são declaradas por data-acao', () => {
    const app_js = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
    const declaradas = new Set([...app_js.matchAll(/data-acao="([a-z-]+)"/g)].map((m) => m[1]));
    // as duas tabelas de despacho precisam cobrir tudo que a interface declara
    const despachadas = new Set([
      ...[...app_js.matchAll(/^\s*'([a-z-]+)':\s*\(/gm)].map((m) => m[1]),
      ...[...app_js.matchAll(/acao === '([a-z-]+)'/g)].map((m) => m[1]),
    ]);
    const orfas = [...declaradas].filter((a) => !despachadas.has(a));
    assert.deepEqual(orfas, [], 'data-acao sem tratamento em nenhum dos dispatchers');
  });
});
