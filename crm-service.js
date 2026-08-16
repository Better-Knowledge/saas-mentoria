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

// Peso de cada etapa no pipeline ponderado (previsão realista em vez da soma bruta:
// um lead recém-chegado de R$ 90 mil não vale R$ 90 mil). Ajuste conforme sua taxa real.
const PESO_ETAPA = { novo: 0.10, qualificacao: 0.25, reuniao: 0.50, proposta: 0.75 };
const DIAS_PARADO = 30; // sem qualquer movimentação => lead esquecido

// Normaliza o autor para os únicos valores válidos de auditoria.
function normAutor(autor) {
  return autor === 'ia' ? 'ia' : 'humano';
}

function hojeISO() { return new Date().toLocaleDateString('en-CA'); } // YYYY-MM-DD

// Data do desfecho, derivada da transição de `resultado` — nunca vem do cliente.
//   em_aberto  -> ganho/perdido : carimba hoje
//   ganho/perdido -> em_aberto  : reabriu, limpa a data
//   ganho <-> perdido           : só corrigiu o desfecho, mantém a data original
function calcFechadoEm(anterior, novo, atual) {
  if (anterior === novo) return atual || null;
  if (novo === 'em_aberto') return null;
  return atual || hojeISO();
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
       valor_estimado, proposta_enviada, status_pagamento, proxima_acao, proxima_acao_data,
       created_by, fechado_em)
    VALUES
      (@nome, @empresa, @cargo, @telefone, @email, @tipo_cliente, @origem, @etapa, @resultado,
       @valor_estimado, @proposta_enviada, @status_pagamento, @proxima_acao, @proxima_acao_data,
       @created_by, @fechado_em)
  `).run({
    ...c,
    created_by: normAutor(autor),
    // lead cadastrado já fechado (acontece via API/MCP) nasce com a data do desfecho
    fechado_em: calcFechadoEm('em_aberto', c.resultado, null),
  });
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
      proxima_acao_data=@proxima_acao_data, fechado_em=@fechado_em,
      updated_at=datetime('now','localtime')
    WHERE id=@id
  `).run({
    ...c, id,
    fechado_em: calcFechadoEm(existente.resultado, c.resultado, existente.fechado_em),
  });
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
}

function moverEtapa(id, { etapa, resultado } = {}) {
  if (etapa && !ETAPAS.includes(etapa)) throw new ErroDominio('Etapa invalida', 400);
  if (resultado && !RESULTADOS.includes(resultado)) throw new ErroDominio('Resultado invalido', 400);
  const existente = db.prepare('SELECT id, resultado, fechado_em FROM clientes WHERE id = ?').get(id);
  if (!existente) throw new ErroDominio('Cliente nao encontrado', 404);
  // arrastar o cartão no funil também pode fechar/reabrir o negócio
  const fechadoEm = calcFechadoEm(
    existente.resultado, resultado || existente.resultado, existente.fechado_em
  );
  db.prepare(`
    UPDATE clientes SET etapa = COALESCE(?, etapa), resultado = COALESCE(?, resultado),
      fechado_em = ?, updated_at = datetime('now','localtime') WHERE id = ?
  `).run(etapa || null, resultado || null, fechadoEm, id);
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

// =================== DASHBOARD ===================
// Uma única leitura agregada para a tela. Tudo é derivado do banco na hora —
// não há tabela de métricas para ficar dessincronizada.
function dashboard({ meses = 12 } = {}) {
  const hojeStr = hojeISO();

  // ---- camada 1: KPIs ----
  const abertos = db.prepare(`
    SELECT etapa, COUNT(*) qtd, COALESCE(SUM(valor_estimado),0) valor
    FROM clientes WHERE resultado = 'em_aberto' GROUP BY etapa
  `).all();
  const pipelineValor = abertos.reduce((s, e) => s + e.valor, 0);
  const pipelineQtd = abertos.reduce((s, e) => s + e.qtd, 0);
  const pipelinePonderado = abertos.reduce((s, e) => s + e.valor * (PESO_ETAPA[e.etapa] ?? 0), 0);

  const fechados = db.prepare(`
    SELECT resultado, COUNT(*) qtd, COALESCE(SUM(valor_estimado),0) valor
    FROM clientes WHERE resultado != 'em_aberto' GROUP BY resultado
  `).all();
  const ganhos = fechados.find(f => f.resultado === 'ganho') || { qtd: 0, valor: 0 };
  const perdidos = fechados.find(f => f.resultado === 'perdido') || { qtd: 0, valor: 0 };
  const totalFechados = ganhos.qtd + perdidos.qtd;

  // ciclo de vendas: só dá para medir onde existe data de desfecho
  const ciclo = db.prepare(`
    SELECT AVG(julianday(fechado_em) - julianday(date(created_at))) dias, COUNT(*) base
    FROM clientes
    WHERE resultado = 'ganho' AND fechado_em IS NOT NULL AND fechado_em >= date(created_at)
  `).get();

  // ---- camada 2: evolução mensal (série contínua, meses vazios inclusos) ----
  const porMesFechado = db.prepare(`
    SELECT substr(fechado_em,1,7) mes, resultado,
           COUNT(*) qtd, COALESCE(SUM(valor_estimado),0) valor
    FROM clientes WHERE fechado_em IS NOT NULL GROUP BY mes, resultado
  `).all();
  const porMesCriado = db.prepare(`
    SELECT substr(created_at,1,7) mes, COUNT(*) qtd FROM clientes GROUP BY mes
  `).all();

  const serie = [];
  const [anoHoje, mesHoje] = hojeStr.split('-').map(Number);
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(anoHoje, mesHoje - 1 - i, 1);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const g = porMesFechado.find(r => r.mes === chave && r.resultado === 'ganho');
    const p = porMesFechado.find(r => r.mes === chave && r.resultado === 'perdido');
    const n = porMesCriado.find(r => r.mes === chave);
    serie.push({
      mes: chave,
      ganhos: g ? g.qtd : 0, valorGanho: g ? g.valor : 0,
      perdidos: p ? p.qtd : 0, valorPerdido: p ? p.valor : 0,
      novos: n ? n.qtd : 0,
    });
  }

  // ---- camada 3: composição ----
  const funil = ETAPAS.map(etapa => {
    const e = abertos.find(a => a.etapa === etapa);
    return {
      etapa, qtd: e ? e.qtd : 0, valor: e ? e.valor : 0,
      peso: PESO_ETAPA[etapa], ponderado: (e ? e.valor : 0) * PESO_ETAPA[etapa],
    };
  });

  // origem medida por valor GANHO, não por volume de leads: 3 indicações que
  // fecham valem mais que 20 cliques que não fecham
  const origens = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(origem),''), 'Sem origem') origem,
           COUNT(*) qtd,
           SUM(CASE WHEN resultado = 'ganho' THEN 1 ELSE 0 END) ganhos,
           COALESCE(SUM(CASE WHEN resultado = 'ganho' THEN valor_estimado ELSE 0 END),0) valorGanho,
           COALESCE(SUM(CASE WHEN resultado = 'em_aberto' THEN valor_estimado ELSE 0 END),0) valorAberto
    FROM clientes GROUP BY origem ORDER BY valorGanho DESC, qtd DESC
  `).all();

  const tipos = db.prepare(`
    SELECT tipo_cliente tipo, COUNT(*) qtd, COALESCE(SUM(valor_estimado),0) valor
    FROM clientes GROUP BY tipo_cliente ORDER BY qtd DESC
  `).all();

  const autoria = db.prepare(`
    SELECT created_by autor, COUNT(*) qtd FROM clientes GROUP BY created_by
  `).all();

  // ---- camada 4: listas de ação ----
  const colunas = 'id, nome, empresa, etapa, valor_estimado, proxima_acao, proxima_acao_data, updated_at';
  const semProximaAcao = db.prepare(`
    SELECT ${colunas} FROM clientes
    WHERE resultado = 'em_aberto' AND (proxima_acao_data IS NULL OR proxima_acao_data = '')
    ORDER BY valor_estimado DESC
  `).all();
  const parados = db.prepare(`
    SELECT ${colunas}, CAST(julianday('now') - julianday(updated_at) AS INTEGER) dias
    FROM clientes
    WHERE resultado = 'em_aberto' AND julianday('now') - julianday(updated_at) >= ?
    ORDER BY updated_at ASC
  `).all(DIAS_PARADO);
  const propostasAbertas = db.prepare(`
    SELECT ${colunas} FROM clientes
    WHERE resultado = 'em_aberto' AND proposta_enviada = 1
    ORDER BY valor_estimado DESC
  `).all();

  return {
    kpis: {
      pipeline: { valor: pipelineValor, qtd: pipelineQtd },
      ponderado: { valor: pipelinePonderado },
      vitoria: {
        pct: totalFechados ? (ganhos.qtd / totalFechados) * 100 : null,
        ganhos: ganhos.qtd, perdidos: perdidos.qtd,
      },
      ticketMedio: { valor: ganhos.qtd ? ganhos.valor / ganhos.qtd : null, base: ganhos.qtd },
      cicloDias: ciclo && ciclo.base ? Math.round(ciclo.dias) : null,
      receitaGanha: ganhos.valor,
    },
    serie,
    funil,
    origens,
    tipos,
    autoria: {
      humano: (autoria.find(a => a.autor === 'humano') || {}).qtd || 0,
      ia: (autoria.find(a => a.autor === 'ia') || {}).qtd || 0,
    },
    atencao: { semProximaAcao, parados, propostasAbertas, diasParado: DIAS_PARADO },
  };
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
  ETAPAS, RESULTADOS, PESO_ETAPA, ErroDominio, montaCliente,
  listarClientes, obterCliente, criarCliente, atualizarCliente, moverEtapa,
  listarInteracoes, registrarInteracao, exportarCliente, excluirCliente, acoesHoje,
  dashboard,
};
