// Retenção, exportação e exclusão da transcrição (US3 / FR-026*).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/app');
const { extratorFixo } = require('./helpers/extrator-falso');

const { crm, db } = h;
const resumo = crm.resumoReuniao;
const TRANSCRICAO = 'Maria disse que o orçamento foi aprovado em quarenta mil reais.';
const REVISADO = { resumo: 'Orçamento aprovado.', decisoes: [{ texto: 'Seguir' }], proximos_passos: [], objecoes: [] };

before(() => require('../auth').bootstrapAdmin());
after(() => h.limpar());

async function comRegistro(nome) {
  const c = h.criarCliente(nome);
  const r = await resumo.criarRascunho(c.id, TRANSCRICAO, h.principalSessao(), extratorFixo());
  const i = resumo.confirmarRascunho(r.id, REVISADO, h.principalSessao());
  return { cliente: c, interacao: i };
}

describe('FR-026c — a transcrição NÃO sai na exportação do titular', () => {
  test('exportarCliente traz ficha, interações e o registro revisado — nunca a fonte', async () => {
    const { cliente } = await comRegistro('Exportação');
    const exportado = crm.exportarCliente(cliente.id);
    const json = JSON.stringify(exportado);
    assert.equal(exportado.interacoes.length, 1, 'o registro revisado está na exportação');
    assert.match(json, /Orçamento aprovado/, 'o conteúdo revisado sai');
    assert.doesNotMatch(json, /quarenta mil reais/, 'a transcrição bruta NÃO sai');
    assert.doesNotMatch(json, /transcricao/i, 'nem sequer a chave aparece');
  });
});

describe('FR-026a — retenção de 90 dias', () => {
  test('vencida some, o registro permanece, e a leitura vira disponivel:false', async () => {
    const { interacao } = await comRegistro('Retenção');
    assert.equal(resumo.obterTranscricao(interacao.id).disponivel, true);

    db.prepare("UPDATE transcricoes SET expira_em = '2000-01-01' WHERE interacao_id = ?").run(interacao.id);
    const r = resumo.purgarExpirados();
    assert.equal(r.transcricoes, 1);

    const depois = resumo.obterTranscricao(interacao.id);
    assert.equal(depois.disponivel, false);
    assert.equal(depois.motivo, 'expirada');
    assert.ok(db.prepare('SELECT id FROM interacoes WHERE id = ?').get(interacao.id),
      'o registro revisado continua no histórico');
  });

  test('a purga não toca no que ainda não venceu', async () => {
    const { interacao } = await comRegistro('Ainda válida');
    resumo.purgarExpirados();
    assert.equal(resumo.obterTranscricao(interacao.id).disponivel, true);
  });

  test('rascunho abandonado há mais de 24 h é descartado junto', async () => {
    const c = h.criarCliente('Abandonado');
    const r = await resumo.criarRascunho(c.id, TRANSCRICAO, h.principalSessao(), extratorFixo());
    db.prepare("UPDATE resumo_rascunhos SET created_at = '2000-01-01 00:00:00' WHERE id = ?").run(r.id);
    const saida = resumo.purgarExpirados();
    assert.equal(saida.rascunhos, 1);
    assert.throws(() => resumo.obterRascunho(r.id, h.principalSessao()), (e) => e.status === 404);
  });
});

describe('FR-026b — exclusão do titular apaga a transcrição antes do prazo', () => {
  test('excluir o cliente leva transcrição e rascunhos junto', async () => {
    const { cliente, interacao } = await comRegistro('Excluído');
    await resumo.criarRascunho(cliente.id, TRANSCRICAO, h.principalSessao(), extratorFixo());
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transcricoes WHERE cliente_id = ?').get(cliente.id).n, 1);

    crm.excluirCliente(cliente.id);

    assert.equal(db.prepare('SELECT COUNT(*) n FROM transcricoes WHERE cliente_id = ?').get(cliente.id).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM resumo_rascunhos WHERE cliente_id = ?').get(cliente.id).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM interacoes WHERE id = ?').get(interacao.id).n, 0);
  });

  test('mas a trilha de auditoria sobrevive — apagar a prova não é direito de ninguém', () => {
    const audit = require('../audit');
    assert.ok(audit.listar().length > 0);
  });
});
