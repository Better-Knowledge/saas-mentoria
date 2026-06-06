// crm-service.js — camada de serviço compartilhada pelas rotas REST e pelas ferramentas MCP.
// Centraliza a lógica de domínio (validação, whitelist de campos, enums e auditoria) para que os
// dois caminhos (navegador via /api e agentes via /mcp) tenham EXATAMENTE o mesmo comportamento.
// A autoria de cada escrita é derivada da credencial autenticada (parâmetro `autor`),
// nunca de um campo enviado pelo cliente.
const db = require('./db');

// etapa: novo | qualificacao | reuniao | proposta  ·  resultado: em_aberto | ganho | perdido
const ETAPAS = ['novo', 'qualificacao', 'reuniao', 'proposta'];
const RESULTADOS = ['em_aberto', 'ganho', 'perdido'];

// Erro de domínio com status HTTP. O handler global do Express e as ferramentas MCP o traduzem
// (400/404 de negócio em vez de 500 genérico).
class ErroDominio extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroDominio';
    this.status = status;
  }
}

// Normaliza o autor para os únicos valores válidos de auditoria.
function normAutor(autor) {
  return autor === 'ia' ? 'ia' : 'humano';
}

// Whitelist de campos (sem mass assignment). created_by/gerado_por_ia NUNCA vêm daqui.
function montaCliente(body) {
  return {
    nome: (body.nome || '').trim(),
    empresa: body.empresa || null,
    cargo: body.cargo || null,
    telefone: body.telefone || null,
    email: body.email || null,
    tipo_cliente: body.tipo_cliente || 'b2b',
    origem: body.origem || null,
    etapa: ETAPAS.includes(body.etapa) ? body.etapa : 'novo',
    resultado: RESULTADOS.includes(body.resultado) ? body.resultado : 'em_aberto',
    valor_estimado: Number(body.valor_estimado) || 0,
    proposta_enviada: body.proposta_enviada ? 1 : 0,
    status_pagamento: body.status_pagamento || null,
    proxima_acao: body.proxima_acao || null,
    proxima_acao_data: body.proxima_acao_data || null,
  };
}

function listarClientes() {
  return db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM interacoes i WHERE i.cliente_id = c.id) AS total_interacoes
    FROM clientes c ORDER BY c.updated_at DESC
  `).all();
}

function obterCliente(id) {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!cliente) throw new ErroDominio('Cliente nao encontrado', 404);
  cliente.interacoes = db.prepare(
    'SELECT * FROM interacoes WHERE cliente_id = ? ORDER BY data DESC'
  ).all(id);
  return cliente;
}

function criarCliente(body, autor) {
  const c = montaCliente(body);
  if (!c.nome) throw new ErroDominio('O campo nome e obrigatorio', 400);
  const info = db.prepare(`
    INSERT INTO clientes
      (nome, empresa, cargo, telefone, email, tipo_cliente, origem, etapa, resultado,
       valor_estimado, proposta_enviada, status_pagamento, proxima_acao, proxima_acao_data, created_by)
    VALUES
      (@nome, @empresa, @cargo, @telefone, @email, @tipo_cliente, @origem, @etapa, @resultado,
       @valor_estimado, @proposta_enviada, @status_pagamento, @proxima_acao, @proxima_acao_data, @created_by)
  `).run({ ...c, created_by: normAutor(autor) });
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarCliente(id, body) {
  const existente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!existente) throw new ErroDominio('Cliente nao encontrado', 404);
  const c = montaCliente({ ...existente, ...body });
  db.prepare(`
    UPDATE clientes SET
      nome=@nome, empresa=@empresa, cargo=@cargo, telefone=@telefone, email=@email,
      tipo_cliente=@tipo_cliente, origem=@origem, etapa=@etapa, resultado=@resultado,
      valor_estimado=@valor_estimado, proposta_enviada=@proposta_enviada,
      status_pagamento=@status_pagamento, proxima_acao=@proxima_acao,
      proxima_acao_data=@proxima_acao_data, updated_at=datetime('now','localtime')
    WHERE id=@id
  `).run({ ...c, id });
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
}

function moverEtapa(id, { etapa, resultado } = {}) {
  if (etapa && !ETAPAS.includes(etapa)) throw new ErroDominio('Etapa invalida', 400);
  if (resultado && !RESULTADOS.includes(resultado)) throw new ErroDominio('Resultado invalido', 400);
  const existente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(id);
  if (!existente) throw new ErroDominio('Cliente nao encontrado', 404);
  db.prepare(`
    UPDATE clientes SET etapa = COALESCE(?, etapa), resultado = COALESCE(?, resultado),
      updated_at = datetime('now','localtime') WHERE id = ?
  `).run(etapa || null, resultado || null, id);
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
}

function listarInteracoes(id) {
  return db.prepare('SELECT * FROM interacoes WHERE cliente_id = ? ORDER BY data DESC').all(id);
}

function registrarInteracao(id, texto, autor) {
  const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(id);
  if (!cliente) throw new ErroDominio('Cliente nao encontrado', 404);
  const t = (texto || '').trim();
  if (!t) throw new ErroDominio('O campo texto e obrigatorio', 400);
  if (t.length > 5000) throw new ErroDominio('Texto muito longo', 400);
  const gerado_por_ia = normAutor(autor) === 'ia' ? 1 : 0;
  const info = db.prepare(
    'INSERT INTO interacoes (cliente_id, texto, gerado_por_ia) VALUES (?, ?, ?)'
  ).run(id, t, gerado_por_ia);
  db.prepare("UPDATE clientes SET updated_at = datetime('now','localtime') WHERE id = ?").run(id);
  return db.prepare('SELECT * FROM interacoes WHERE id = ?').get(info.lastInsertRowid);
}

function exportarCliente(id) {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!cliente) throw new ErroDominio('Cliente nao encontrado', 404);
  cliente.interacoes = db.prepare('SELECT * FROM interacoes WHERE cliente_id = ?').all(id);
  return cliente;
}

function excluirCliente(id) {
  const info = db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
  if (info.changes === 0) throw new ErroDominio('Cliente nao encontrado', 404);
  return { ok: true, removido: Number(id) };
}

function acoesHoje() {
  const todas = db.prepare(`
    SELECT id, nome, empresa, etapa, valor_estimado, proxima_acao, proxima_acao_data
    FROM clientes
    WHERE resultado = 'em_aberto'
      AND proxima_acao_data IS NOT NULL AND proxima_acao_data != ''
    ORDER BY proxima_acao_data ASC
  `).all();
  const hojeStr = new Date().toLocaleDateString('en-CA');
  return {
    atrasados: todas.filter(c => c.proxima_acao_data < hojeStr),
    hoje: todas.filter(c => c.proxima_acao_data === hojeStr),
    futuros: todas.filter(c => c.proxima_acao_data > hojeStr),
  };
}

module.exports = {
  ETAPAS, RESULTADOS, ErroDominio, montaCliente,
  listarClientes, obterCliente, criarCliente, atualizarCliente, moverEtapa,
  listarInteracoes, registrarInteracao, exportarCliente, excluirCliente, acoesHoje,
};
