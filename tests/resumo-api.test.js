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
// Contratos HTTP das rotas de resumo (contracts/rest-resumos.md).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/app');
const { extratorFixo, extratorQuebrado } = require('./helpers/extrator-falso');

const { crm, request } = h;
let app;

before(async () => {
  app = await h.app();
  crm.resumoReuniao.definirExtrator(extratorFixo());
});
after(() => { crm.resumoReuniao.definirExtrator(null); h.limpar(); });

const REVISADO = {
  resumo: 'Resumo revisado por uma pessoa.',
  decisoes: [{ texto: 'Seguir com o diagnóstico' }],
  proximos_passos: [],
  objecoes: [],
};

describe('POST /api/clientes/:id/resumos', () => {
  test('401 sem credencial', async () => {
    const c = h.criarCliente();
    await request(app).post(`/api/clientes/${c.id}/resumos`).send({ transcricao: 'oi' }).expect(401);
  });

  test('403 com sessão e sem token CSRF', async () => {
    const c = h.criarCliente();
    const { agente } = await h.logar();
    await agente.post(`/api/clientes/${c.id}/resumos`).send({ transcricao: 'oi' }).expect(403);
  });

  test('201 e nada gravado no histórico', async () => {
    const c = h.criarCliente();
    const { agente, csrf } = await h.logar();
    const r = await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf).send({ transcricao: 'Reunião com a Maria.' }).expect(201);
    assert.ok(r.body.id);
    assert.equal(crm.listarInteracoes(c.id).length, 0);
  });

  test('404 de cliente inexistente', async () => {
    const { agente, csrf } = await h.logar();
    await agente.post('/api/clientes/99999/resumos')
      .set('x-csrf-token', csrf).send({ transcricao: 'oi' }).expect(404);
  });

  test('413 acima de 512 KB — e o limite de 64 KB segue valendo nas demais rotas', async () => {
    const c = h.criarCliente();
    const { agente, csrf } = await h.logar();
    await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf)
      .send({ transcricao: 'x'.repeat(600 * 1024) })
      .expect(413);
    // a mesma carga numa rota comum é barrada bem antes, pelo limite global
    await agente.post('/api/clientes')
      .set('x-csrf-token', csrf).send({ nome: 'x'.repeat(70 * 1024) }).expect(413);
  });

  test('400 acima do limite de caracteres, antes de qualquer chamada paga', async () => {
    const c = h.criarCliente();
    const { agente, csrf } = await h.logar();
    crm.resumoReuniao.definirExtrator(null);   // extrator REAL: recusa por tamanho antes de sair da máquina
    const r = await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf).send({ transcricao: 'a'.repeat(200_001) }).expect(400);
    assert.match(r.body.erro, /muito longa/i);
    crm.resumoReuniao.definirExtrator(extratorFixo());
  });

  test('503 quando o serviço de IA não está configurado, sem gravar nada', async () => {
    const c = h.criarCliente();
    const { agente, csrf } = await h.logar();
    crm.resumoReuniao.definirExtrator(null);   // sem ANTHROPIC_API_KEY no ambiente de teste
    const r = await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf).send({ transcricao: 'Reunião curta.' }).expect(503);
    assert.equal(r.body.ia_configurada, false, 'distingue "não configurado" de "falhou agora"');
    assert.equal(crm.listarInteracoes(c.id).length, 0);
    crm.resumoReuniao.definirExtrator(extratorFixo());
  });

  test('503 quando o serviço falha agora — nenhum registro parcial', async () => {
    const c = h.criarCliente();
    const { agente, csrf } = await h.logar();
    crm.resumoReuniao.definirExtrator(extratorQuebrado());
    const r = await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf).send({ transcricao: 'Reunião curta.' }).expect(503);
    assert.equal(r.body.ia_configurada, true);
    assert.equal(crm.listarInteracoes(c.id).length, 0);
    crm.resumoReuniao.definirExtrator(extratorFixo());
  });
});

describe('confirmar, descartar e ler rascunho', () => {
  async function comRascunho() {
    const c = h.criarCliente();
    const { agente, csrf } = await h.logar();
    const r = await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf).send({ transcricao: 'Reunião.' }).expect(201);
    return { c, agente, csrf, rascunho: r.body };
  }

  test('GET devolve ao dono e 404 para outra credencial', async () => {
    const { agente, rascunho } = await comRascunho();
    await agente.get(`/api/resumos/${rascunho.id}`).expect(200);
    const chave = h.criarChave('outra');
    await request(app).get(`/api/resumos/${rascunho.id}`)
      .set('Authorization', `Bearer ${chave.chave}`).expect(404);
  });

  test('confirmar grava a interação marcada como revisada por humano', async () => {
    const { c, agente, csrf, rascunho } = await comRascunho();
    const r = await agente.post(`/api/resumos/${rascunho.id}/confirmar`)
      .set('x-csrf-token', csrf).send(REVISADO).expect(201);
    assert.equal(r.body.revisao, 'humana');
    assert.equal(r.body.gerado_por_ia, 1);
    assert.ok(r.body.transcricao_id);
    assert.equal(crm.listarInteracoes(c.id).length, 1);
  });

  test('confirmar rascunho vazio responde 400', async () => {
    const { agente, csrf, rascunho } = await comRascunho();
    await agente.post(`/api/resumos/${rascunho.id}/confirmar`)
      .set('x-csrf-token', csrf).send({ resumo: '', decisoes: [], proximos_passos: [], objecoes: [] })
      .expect(400);
  });

  test('409 ao substituir próxima ação vigente, com o valor atual no corpo', async () => {
    const c = h.criarCliente('Com ação', { proxima_acao: 'Ligar', proxima_acao_data: '2026-09-01' });
    const { agente, csrf } = await h.logar();
    const cr = await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf).send({ transcricao: 'Reunião.' }).expect(201);
    const r = await agente.post(`/api/resumos/${cr.body.id}/confirmar`)
      .set('x-csrf-token', csrf)
      .send({ ...REVISADO, promover_proxima_acao: { texto: 'Nova', data: '2026-09-10' } })
      .expect(409);
    assert.equal(r.body.proxima_acao_vigente.proxima_acao, 'Ligar');
  });

  test('DELETE devolve 204 e não grava nada', async () => {
    const { c, agente, csrf, rascunho } = await comRascunho();
    await agente.delete(`/api/resumos/${rascunho.id}`).set('x-csrf-token', csrf).expect(204);
    assert.equal(crm.listarInteracoes(c.id).length, 0);
    await agente.get(`/api/resumos/${rascunho.id}`).expect(404);
  });
});

describe('T075 — sessão expirada durante a revisão', () => {
  test('a confirmação responde 401 e o rascunho deixa de ser alcançável', async () => {
    const c = h.criarCliente('Sessão expira');
    const { agente, csrf } = await h.logar({ novo: true });
    const cr = await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf).send({ transcricao: 'Reunião.' }).expect(201);

    // A pessoa sai (ou a sessão expira) enquanto a revisão está na tela.
    await agente.post('/api/auth/logout').expect(200);

    await agente.post(`/api/resumos/${cr.body.id}/confirmar`)
      .set('x-csrf-token', csrf).send(REVISADO).expect(401);
    await agente.get(`/api/resumos/${cr.body.id}`).expect(401);
    assert.equal(crm.listarInteracoes(c.id).length, 0, 'nada foi gravado');
  });

  test('o front trata 401 nos caminhos de fetch cru (FR-094)', () => {
    // Guarda de regressão sobre o código do cliente: extrairResumo e confirmarResumo usam
    // fetch cru (AbortController e 409) e por isso não herdam o tratamento de api().
    const fs = require('node:fs');
    const path = require('node:path');
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const bloco = app.slice(app.indexOf('async function extrairResumo'), app.indexOf('async function descartarResumo'));
    const ocorrencias = bloco.match(/r\.status === 401/g) || [];
    assert.equal(ocorrencias.length, 2,
      'extrairResumo e confirmarResumo devem devolver a pessoa ao login em 401');
    assert.match(bloco, /mostrarLogin\(\)/);
  });
});

describe('GET /api/interacoes/:id/transcricao', () => {
  test('200 com a fonte, e 200 com disponivel:false depois de expirada', async () => {
    const c = h.criarCliente();
    const { agente, csrf } = await h.logar();
    const cr = await agente.post(`/api/clientes/${c.id}/resumos`)
      .set('x-csrf-token', csrf).send({ transcricao: 'Fonte conferível.' }).expect(201);
    const i = await agente.post(`/api/resumos/${cr.body.id}/confirmar`)
      .set('x-csrf-token', csrf).send(REVISADO).expect(201);

    const t = await agente.get(`/api/interacoes/${i.body.id}/transcricao`).expect(200);
    assert.equal(t.body.disponivel, true);
    assert.equal(t.body.texto, 'Fonte conferível.');

    h.db.prepare("UPDATE transcricoes SET expira_em = '2000-01-01' WHERE interacao_id = ?").run(i.body.id);
    crm.resumoReuniao.purgarExpirados();
    const t2 = await agente.get(`/api/interacoes/${i.body.id}/transcricao`).expect(200);
    assert.equal(t2.body.disponivel, false);
    assert.equal(t2.body.motivo, 'expirada');
  });
});

// ---------------------------------------------------------------------------
// T022b — regressão dos dois planos de credencial.
// Este teste existe para impedir o vazamento de plano descrito em auth.js: se ele
// passar a falhar, a separação resolverBearer/resolverSessao foi desfeita.
// ---------------------------------------------------------------------------
describe('T022b — os dois planos de credencial não se substituem', () => {
  test('Bearer inválido + cookie de sessão válido NÃO abre o endpoint MCP', async () => {
    const { agente } = await h.logar();
    const r = await agente.post('/mcp')
      .set('Authorization', 'Bearer chave-invalida-qualquer')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(r.status, 401, 'cookie de sessão jamais pode valer como chave de API');
  });

  test('cookie de sessão sozinho não abre o endpoint MCP', async () => {
    const { agente } = await h.logar();
    const r = await agente.post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(r.status, 401);
  });

  test('chave de API válida abre o endpoint MCP', async () => {
    const chave = h.criarChave('mcp-ok');
    const r = await request(app).post('/mcp')
      .set('Authorization', `Bearer ${chave.chave}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(r.status, 200);
  });

  test('Bearer inválido numa rota /api não cai para a sessão', async () => {
    const { agente } = await h.logar();
    await agente.get('/api/clientes').set('Authorization', 'Bearer invalida').expect(401);
    await agente.get('/api/clientes').expect(200);
  });
});
