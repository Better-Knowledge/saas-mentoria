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
// Regras de domínio do resumo de reunião (US1 e US2).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/app');
const { extratorFixo } = require('./helpers/extrator-falso');

const { crm, db } = h;
const resumo = crm.resumoReuniao;

before(() => { require('../auth').bootstrapAdmin(); });
after(() => h.limpar());

const REVISADO = {
  resumo: 'Reunião com a Maria sobre diagnóstico.',
  decisoes: [{ texto: 'Contratar o diagnóstico' }],
  proximos_passos: [{ texto: 'Enviar proposta', responsavel: 'Farley', prazo: '2026-09-05' }],
  objecoes: [],
};

async function rascunhoPara(cliente, principal, extrator = extratorFixo()) {
  return resumo.criarRascunho(cliente.id, 'Transcrição de teste da reunião.', principal, extrator);
}

describe('US1 — criar rascunho', () => {
  test('não grava nada no histórico do cliente', async () => {
    const c = h.criarCliente();
    const r = await rascunhoPara(c, h.principalSessao());
    assert.ok(r.id, 'devolve um rascunho');
    assert.equal(crm.listarInteracoes(c.id).length, 0, 'histórico segue vazio antes de confirmar');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transcricoes').get().n, 0);
  });

  test('cliente inexistente responde 404', async () => {
    await assert.rejects(
      () => resumo.criarRascunho(99999, 'texto', h.principalSessao(), extratorFixo()),
      (e) => e.status === 404,
    );
  });

  test('registra modelo e tokens da chamada (observabilidade de custo)', async () => {
    const c = h.criarCliente();
    const r = await rascunhoPara(c, h.principalSessao());
    assert.equal(r.modelo, 'modelo-de-teste');
    assert.equal(r.tokens_entrada, 1234);
    assert.equal(r.tokens_saida, 56);
  });
});

describe('US1 — posse do rascunho', () => {
  test('rascunho de outra credencial responde 404, nunca 403', async () => {
    const c = h.criarCliente();
    const r = await rascunhoPara(c, h.principalChave(1));
    assert.throws(() => resumo.obterRascunho(r.id, h.principalChave(2)), (e) => e.status === 404);
    assert.throws(() => resumo.obterRascunho(r.id, h.principalSessao()), (e) => e.status === 404);
    assert.ok(resumo.obterRascunho(r.id, h.principalChave(1)).id, 'o dono enxerga');
  });
});

describe('US1 — confirmar', () => {
  test('grava o conteúdo REVISADO, não o que o modelo produziu', async () => {
    const c = h.criarCliente();
    const r = await rascunhoPara(c, h.principalSessao());
    const i = resumo.confirmarRascunho(r.id, REVISADO, h.principalSessao());
    assert.match(i.texto, /Maria sobre diagnóstico/);
    assert.doesNotMatch(i.texto, /Resumo de teste/, 'a versão do modelo não vai para o histórico');
    assert.doesNotMatch(i.texto, /Achou o prazo curto/, 'item removido na revisão não é gravado');
    assert.equal(i.gerado_por_ia, 1);
    assert.equal(i.origem_registro, 'resumo_reuniao');
  });

  test('consome o rascunho e guarda a transcrição por 90 dias', async () => {
    const c = h.criarCliente();
    const r = await rascunhoPara(c, h.principalSessao());
    const i = resumo.confirmarRascunho(r.id, REVISADO, h.principalSessao());
    assert.throws(() => resumo.obterRascunho(r.id, h.principalSessao()), (e) => e.status === 404);
    const t = resumo.obterTranscricao(i.id);
    assert.equal(t.disponivel, true);
    const dias = (Date.parse(`${t.expira_em}T00:00:00Z`) - Date.parse(`${new Date().toLocaleDateString('en-CA')}T00:00:00Z`)) / 86400000;
    assert.equal(dias, 90);
  });

  test('rascunho vazio é recusado com 400', async () => {
    const c = h.criarCliente();
    const r = await rascunhoPara(c, h.principalSessao());
    assert.throws(
      () => resumo.confirmarRascunho(r.id, { resumo: '  ', decisoes: [], proximos_passos: [], objecoes: [] }, h.principalSessao()),
      (e) => e.status === 400 && /Nada a salvar/.test(e.message),
    );
    assert.equal(crm.listarInteracoes(c.id).length, 0);
  });

  test('atualiza a última movimentação do cliente', async () => {
    const c = h.criarCliente();
    const antes = db.prepare('SELECT updated_at FROM clientes WHERE id = ?').get(c.id).updated_at;
    const r = await rascunhoPara(c, h.principalSessao());
    db.prepare("UPDATE clientes SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(c.id);
    resumo.confirmarRascunho(r.id, REVISADO, h.principalSessao());
    const depois = db.prepare('SELECT updated_at FROM clientes WHERE id = ?').get(c.id).updated_at;
    assert.notEqual(depois, '2000-01-01 00:00:00');
    assert.ok(antes);
  });
});

describe('US1 — descartar', () => {
  test('não grava conteúdo algum', async () => {
    const c = h.criarCliente();
    const r = await rascunhoPara(c, h.principalSessao());
    resumo.descartarRascunho(r.id, h.principalSessao());
    assert.equal(crm.listarInteracoes(c.id).length, 0);
    assert.throws(() => resumo.obterRascunho(r.id, h.principalSessao()), (e) => e.status === 404);
  });
});

describe('US1 — cliente excluído durante a revisão', () => {
  test('a confirmação falha com 404 e não deixa registro órfão', async () => {
    const c = h.criarCliente();
    const r = await rascunhoPara(c, h.principalSessao());
    crm.excluirCliente(c.id);   // cascata leva o rascunho junto
    assert.throws(() => resumo.confirmarRascunho(r.id, REVISADO, h.principalSessao()), (e) => e.status === 404);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM interacoes WHERE cliente_id = ?').get(c.id).n, 0);
  });
});

describe('FR-004 — o sistema não inventa prazo', () => {
  test('próximo passo sem prazo declarado chega ao histórico sem data', async () => {
    const c = h.criarCliente('Sem prazo');
    const semPrazo = extratorFixo({
      proximos_passos: [{ texto: 'Retomar a conversa', responsavel: null, prazo: null }],
    });
    const r = await resumo.criarRascunho(c.id, 'Reunião sem prazo definido.', h.principalSessao(), semPrazo);
    assert.equal(r.proximos_passos[0].prazo, null);
    assert.equal(r.proximos_passos[0].responsavel, null);

    const i = resumo.confirmarRascunho(r.id, {
      resumo: 'Conversa exploratória.',
      decisoes: [],
      proximos_passos: [{ texto: 'Retomar a conversa', responsavel: null, prazo: null }],
      objecoes: [],
    }, h.principalSessao());
    assert.match(i.texto, /Retomar a conversa/);
    assert.doesNotMatch(i.texto, /\(\s*\)/, 'sem parênteses vazios de responsável/prazo ausentes');
    assert.doesNotMatch(i.texto, /\d{4}-\d{2}-\d{2}/, 'nenhuma data foi inventada');
  });

  test('promover a próxima ação sem data é recusado — não se estima prazo', async () => {
    const c = h.criarCliente('Promoção sem data');
    const r = await rascunhoPara(c, h.principalSessao());
    assert.throws(
      () => resumo.confirmarRascunho(
        r.id, { ...REVISADO, promover_proxima_acao: { texto: 'Retomar', data: null } },
        h.principalSessao()),
      (e) => e.status === 400,
    );
    assert.equal(db.prepare('SELECT proxima_acao FROM clientes WHERE id = ?').get(c.id).proxima_acao, null);
  });
});

describe('SC-002 — a duração da extração é registrada', () => {
  test('o rascunho guarda quanto tempo a chamada levou', async () => {
    const c = h.criarCliente('Com duração');
    const r = await rascunhoPara(c, h.principalSessao());
    assert.equal(typeof r.duracao_ms, 'number');
    assert.ok(r.duracao_ms >= 0);
  });
});

describe('US2 — promover próxima ação', () => {
  test('sem promover, o cliente fica exatamente como estava', async () => {
    const c = h.criarCliente('Sem promoção', { proxima_acao: 'Ligar', proxima_acao_data: '2026-09-01' });
    const antes = db.prepare('SELECT * FROM clientes WHERE id = ?').get(c.id);
    const r = await rascunhoPara(c, h.principalSessao());
    resumo.confirmarRascunho(r.id, REVISADO, h.principalSessao());
    const depois = db.prepare('SELECT * FROM clientes WHERE id = ?').get(c.id);
    for (const campo of ['proxima_acao', 'proxima_acao_data', 'valor_estimado', 'etapa',
      'resultado', 'tipo_cliente', 'proposta_enviada', 'status_pagamento']) {
      assert.equal(depois[campo], antes[campo], `campo ${campo} não pode mudar`);
    }
  });

  test('promover grava próxima ação e data', async () => {
    const c = h.criarCliente('Promove');
    const r = await rascunhoPara(c, h.principalSessao());
    resumo.confirmarRascunho(
      r.id, { ...REVISADO, promover_proxima_acao: { texto: 'Enviar proposta', data: '2026-09-05' } },
      h.principalSessao(),
    );
    const d = db.prepare('SELECT * FROM clientes WHERE id = ?').get(c.id);
    assert.equal(d.proxima_acao, 'Enviar proposta');
    assert.equal(d.proxima_acao_data, '2026-09-05');
  });

  test('data inválida recusa sem alterar o cliente', async () => {
    const c = h.criarCliente('Data ruim');
    const r = await rascunhoPara(c, h.principalSessao());
    assert.throws(
      () => resumo.confirmarRascunho(
        r.id, { ...REVISADO, promover_proxima_acao: { texto: 'X', data: '05/09/2026' } }, h.principalSessao()),
      (e) => e.status === 400,
    );
    const d = db.prepare('SELECT * FROM clientes WHERE id = ?').get(c.id);
    assert.equal(d.proxima_acao, null, 'nada foi gravado no cliente');
    assert.equal(crm.listarInteracoes(c.id).length, 0, 'nem a interação foi criada');
  });

  test('substituir ação vigente exige confirmação e devolve o valor atual', async () => {
    const c = h.criarCliente('Já tem ação', { proxima_acao: 'Ligar', proxima_acao_data: '2026-09-01' });
    const r = await rascunhoPara(c, h.principalSessao());
    assert.throws(
      () => resumo.confirmarRascunho(
        r.id, { ...REVISADO, promover_proxima_acao: { texto: 'Outra', data: '2026-09-09' } }, h.principalSessao()),
      (e) => e.status === 409 && e.proxima_acao_vigente.proxima_acao === 'Ligar',
    );
    // com substituir: true, passa
    resumo.confirmarRascunho(
      r.id, { ...REVISADO, promover_proxima_acao: { texto: 'Outra', data: '2026-09-09', substituir: true } },
      h.principalSessao(),
    );
    assert.equal(db.prepare('SELECT proxima_acao FROM clientes WHERE id = ?').get(c.id).proxima_acao, 'Outra');
  });
});

describe('US3 — plano de credencial e auditoria', () => {
  test('sessão grava revisao=humana; chave de API grava sem_revisao', async () => {
    const c1 = h.criarCliente('Por pessoa');
    const r1 = await rascunhoPara(c1, h.principalSessao());
    const i1 = resumo.confirmarRascunho(r1.id, REVISADO, h.principalSessao());
    assert.equal(i1.revisao, 'humana');
    assert.ok(i1.revisado_por, 'registra quem revisou');

    const c2 = h.criarCliente('Por máquina');
    const r2 = await rascunhoPara(c2, h.principalChave(7));
    const i2 = resumo.confirmarRascunho(r2.id, REVISADO, h.principalChave(7));
    assert.equal(i2.revisao, 'sem_revisao');
    assert.equal(i2.revisado_por, null);
  });

  test('a trilha distingue os dois casos e não guarda conteúdo da reunião', async () => {
    const audit = require('../audit');
    const c = h.criarCliente('Auditado');
    const r = await rascunhoPara(c, h.principalChave(9));
    const i = resumo.confirmarRascunho(r.id, REVISADO, h.principalChave(9));
    const linhas = audit.listar({ entidade: 'interacao', entidade_id: i.id });
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].autor, 'ia');
    assert.equal(linhas[0].credencial, 'apikey');
    assert.equal(linhas[0].valor_novo, 'sem_revisao');
    const tudo = JSON.stringify(audit.listar());
    assert.doesNotMatch(tudo, /Maria sobre diagnóstico/, 'trilha não reproduz o conteúdo');
    assert.doesNotMatch(tudo, /Transcrição de teste/, 'trilha não reproduz a transcrição');
  });

  test('promoção de próxima ação é atribuída a quem confirmou, não à IA', async () => {
    const audit = require('../audit');
    const c = h.criarCliente('Atribuição');
    const r = await rascunhoPara(c, h.principalSessao());
    resumo.confirmarRascunho(
      r.id, { ...REVISADO, promover_proxima_acao: { texto: 'Enviar', data: '2026-09-05' } },
      h.principalSessao(),
    );
    const linhas = audit.listar({ entidade: 'cliente', entidade_id: c.id });
    assert.equal(linhas.length, 2, 'proxima_acao e proxima_acao_data');
    for (const l of linhas) {
      assert.equal(l.autor, 'humano');
      assert.equal(l.credencial, 'sessao');
    }
    assert.deepEqual(linhas.map((l) => l.campo).sort(), ['proxima_acao', 'proxima_acao_data']);
  });
});
