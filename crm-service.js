// crm-service.js — camada de serviço compartilhada por REST, MCP e (futuramente) Gordon.
// Centraliza a lógica de domínio (validação, whitelist, enums, auditoria). PostgreSQL multi-tenant:
// cada função recebe um `client` já dentro de withOrg() — o RLS isola a organização e os INSERTs
// derivam o org_id de `current_setting('app.current_org')`. A autoria (`autor`) vem da credencial,
// nunca de um campo do cliente.

const ETAPAS = ['novo', 'qualificacao', 'reuniao', 'proposta'];
const RESULTADOS = ['em_aberto', 'ganho', 'perdido'];

class ErroDominio extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroDominio';
    this.status = status;
  }
}

function normAutor(autor) {
  return autor === 'ia' ? 'ia' : 'humano';
}

// Whitelist de campos (sem mass assignment). org_id/created_by/gerado_por_ia NUNCA vêm daqui.
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
    proposta_enviada: body.proposta_enviada ? true : false,
    status_pagamento: body.status_pagamento || null,
    proxima_acao: body.proxima_acao || null,
    proxima_acao_data: body.proxima_acao_data || null,
  };
}

async function listarClientes(client) {
  const { rows } = await client.query(`
    SELECT c.*, (SELECT COUNT(*) FROM interacoes i WHERE i.cliente_id = c.id) AS total_interacoes
    FROM clientes c ORDER BY c.updated_at DESC
  `);
  return rows;
}

async function obterCliente(client, id) {
  const { rows } = await client.query('SELECT * FROM clientes WHERE id = $1', [id]);
  const cliente = rows[0];
  if (!cliente) throw new ErroDominio('Cliente nao encontrado', 404);
  cliente.interacoes = (await client.query(
    'SELECT * FROM interacoes WHERE cliente_id = $1 ORDER BY data DESC', [id]
  )).rows;
  return cliente;
}

async function criarCliente(client, body, autor) {
  const c = montaCliente(body);
  if (!c.nome) throw new ErroDominio('O campo nome e obrigatorio', 400);
  // Limite de clientes do plano — imposto no servidor em TODOS os caminhos (REST, MCP, Gordon).
  const { rows: lim } = await client.query(`
    SELECT p.limite_clientes FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.org_id = current_setting('app.current_org')::uuid`);
  if (lim[0] && lim[0].limite_clientes != null) {
    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM clientes');
    if (cnt[0].n >= lim[0].limite_clientes) {
      throw new ErroDominio(`Limite de ${lim[0].limite_clientes} clientes do plano atingido`, 403);
    }
  }
  const { rows } = await client.query(`
    INSERT INTO clientes
      (org_id, nome, empresa, cargo, telefone, email, tipo_cliente, origem, etapa, resultado,
       valor_estimado, proposta_enviada, status_pagamento, proxima_acao, proxima_acao_data, created_by)
    VALUES
      (current_setting('app.current_org')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`,
    [c.nome, c.empresa, c.cargo, c.telefone, c.email, c.tipo_cliente, c.origem, c.etapa, c.resultado,
     c.valor_estimado, c.proposta_enviada, c.status_pagamento, c.proxima_acao, c.proxima_acao_data,
     normAutor(autor)]);
  return rows[0];
}

async function atualizarCliente(client, id, body) {
  const { rows: ex } = await client.query('SELECT * FROM clientes WHERE id = $1', [id]);
  if (!ex[0]) throw new ErroDominio('Cliente nao encontrado', 404);
  const c = montaCliente({ ...ex[0], ...body });
  const { rows } = await client.query(`
    UPDATE clientes SET
      nome=$1, empresa=$2, cargo=$3, telefone=$4, email=$5, tipo_cliente=$6, origem=$7,
      etapa=$8, resultado=$9, valor_estimado=$10, proposta_enviada=$11, status_pagamento=$12,
      proxima_acao=$13, proxima_acao_data=$14, updated_at=now()
    WHERE id=$15 RETURNING *`,
    [c.nome, c.empresa, c.cargo, c.telefone, c.email, c.tipo_cliente, c.origem, c.etapa, c.resultado,
     c.valor_estimado, c.proposta_enviada, c.status_pagamento, c.proxima_acao, c.proxima_acao_data, id]);
  return rows[0];
}

async function moverEtapa(client, id, { etapa, resultado } = {}) {
  if (etapa && !ETAPAS.includes(etapa)) throw new ErroDominio('Etapa invalida', 400);
  if (resultado && !RESULTADOS.includes(resultado)) throw new ErroDominio('Resultado invalido', 400);
  const { rows: ex } = await client.query('SELECT id FROM clientes WHERE id = $1', [id]);
  if (!ex[0]) throw new ErroDominio('Cliente nao encontrado', 404);
  const { rows } = await client.query(`
    UPDATE clientes SET etapa = COALESCE($1, etapa), resultado = COALESCE($2, resultado),
      updated_at = now() WHERE id = $3 RETURNING *`,
    [etapa || null, resultado || null, id]);
  return rows[0];
}

async function listarInteracoes(client, id) {
  return (await client.query(
    'SELECT * FROM interacoes WHERE cliente_id = $1 ORDER BY data DESC', [id]
  )).rows;
}

async function registrarInteracao(client, id, texto, autor) {
  const { rows: ex } = await client.query('SELECT id FROM clientes WHERE id = $1', [id]);
  if (!ex[0]) throw new ErroDominio('Cliente nao encontrado', 404);
  const t = (texto || '').trim();
  if (!t) throw new ErroDominio('O campo texto e obrigatorio', 400);
  if (t.length > 5000) throw new ErroDominio('Texto muito longo', 400);
  const { rows } = await client.query(`
    INSERT INTO interacoes (org_id, cliente_id, texto, gerado_por_ia)
    VALUES (current_setting('app.current_org')::uuid, $1, $2, $3) RETURNING *`,
    [id, t, normAutor(autor) === 'ia']);
  await client.query('UPDATE clientes SET updated_at = now() WHERE id = $1', [id]);
  return rows[0];
}

async function exportarCliente(client, id) {
  const { rows } = await client.query('SELECT * FROM clientes WHERE id = $1', [id]);
  const cliente = rows[0];
  if (!cliente) throw new ErroDominio('Cliente nao encontrado', 404);
  cliente.interacoes = (await client.query(
    'SELECT * FROM interacoes WHERE cliente_id = $1', [id]
  )).rows;
  return cliente;
}

async function excluirCliente(client, id) {
  const r = await client.query('DELETE FROM clientes WHERE id = $1', [id]);
  if (r.rowCount === 0) throw new ErroDominio('Cliente nao encontrado', 404);
  return { ok: true, removido: id };
}

// ===================== Interações tipadas (reuso interno) =====================
const TIPOS_INTERACAO = ['nota', 'resumo_ia', 'sentimento', 'mensagem_whatsapp'];

// Registra uma interação com tipo/metadata explícitos (ex.: handoff, mensagem de WhatsApp gerada por IA,
// nota de "documento gerado"). Mantém o RLS derivando org_id do contexto.
async function registrarInteracaoTipo(client, id, { texto, tipo = 'nota', gerado_por_ia = false, metadata = null }) {
  const t = (texto || '').trim();
  if (!t) throw new ErroDominio('O campo texto e obrigatorio', 400);
  const tp = TIPOS_INTERACAO.includes(tipo) ? tipo : 'nota';
  const { rows } = await client.query(`
    INSERT INTO interacoes (org_id, cliente_id, texto, tipo, gerado_por_ia, metadata)
    VALUES (current_setting('app.current_org')::uuid, $1, $2, $3, $4, $5) RETURNING *`,
    [id, t, tp, !!gerado_por_ia, metadata]);
  await client.query('UPDATE clientes SET updated_at = now() WHERE id = $1', [id]);
  return rows[0];
}

// ===================== Documentos de contexto do Lead =====================
const TIPOS_DOC = ['transcricao', 'resumo', 'documento', 'proposta'];

async function listarDocumentos(client, clienteId) {
  return (await client.query(
    `SELECT id, tipo, titulo, gerado_por_ia, created_by, created_at
     FROM lead_documents WHERE cliente_id = $1 ORDER BY created_at DESC`, [clienteId]
  )).rows;
}

async function obterDocumento(client, clienteId, docId) {
  const { rows } = await client.query(
    'SELECT * FROM lead_documents WHERE id = $1 AND cliente_id = $2', [docId, clienteId]);
  if (!rows[0]) throw new ErroDominio('Documento nao encontrado', 404);
  return rows[0];
}

async function criarDocumento(client, clienteId, { tipo, titulo, conteudo, origem = null }, autor) {
  const { rows: ex } = await client.query('SELECT id FROM clientes WHERE id = $1', [clienteId]);
  if (!ex[0]) throw new ErroDominio('Cliente nao encontrado', 404);
  if (!TIPOS_DOC.includes(tipo)) throw new ErroDominio('Tipo de documento invalido', 400);
  const tit = (titulo || '').trim() || tipo;
  const cont = (conteudo || '').toString();
  if (!cont.trim()) throw new ErroDominio('O conteudo do documento e obrigatorio', 400);
  if (cont.length > 100000) throw new ErroDominio('Documento muito longo', 400);
  const { rows } = await client.query(`
    INSERT INTO lead_documents (org_id, cliente_id, tipo, titulo, conteudo, gerado_por_ia, origem, created_by)
    VALUES (current_setting('app.current_org')::uuid, $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [clienteId, tipo, tit.slice(0, 200), cont, normAutor(autor) === 'ia', origem, normAutor(autor)]);
  await client.query('UPDATE clientes SET updated_at = now() WHERE id = $1', [clienteId]);
  return rows[0];
}

async function excluirDocumento(client, clienteId, docId) {
  const r = await client.query('DELETE FROM lead_documents WHERE id = $1 AND cliente_id = $2', [docId, clienteId]);
  if (r.rowCount === 0) throw new ErroDominio('Documento nao encontrado', 404);
  return { ok: true, removido: docId };
}

// ===================== Config de IA por Lead =====================
const AI_CONFIG_BOOL = ['auto_sentimento', 'auto_resposta'];
const AI_CONFIG_PADRAO = { auto_sentimento: true, auto_resposta: false, persona: '', rate_limite: null };

async function obterAiConfig(client, clienteId) {
  const { rows } = await client.query('SELECT ai_config FROM clientes WHERE id = $1', [clienteId]);
  if (!rows[0]) throw new ErroDominio('Cliente nao encontrado', 404);
  return { ...AI_CONFIG_PADRAO, ...(rows[0].ai_config || {}) };
}

// Merge defensivo: só aceita chaves conhecidas e valida tipos. Retorna a config resultante.
async function atualizarAiConfig(client, clienteId, patch = {}) {
  const limpo = {};
  for (const k of AI_CONFIG_BOOL) if (k in patch) limpo[k] = !!patch[k];
  if ('persona' in patch) limpo.persona = String(patch.persona || '').slice(0, 4000);
  if ('rate_limite' in patch && patch.rate_limite && typeof patch.rate_limite === 'object') {
    const max = Number(patch.rate_limite.max);
    const janela = Number(patch.rate_limite.janela_min);
    limpo.rate_limite = {
      max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 5,
      janela_min: Number.isFinite(janela) && janela > 0 ? Math.floor(janela) : 10,
    };
  }
  if (Object.keys(limpo).length === 0) return obterAiConfig(client, clienteId);
  const { rows } = await client.query(
    'UPDATE clientes SET ai_config = ai_config || $1::jsonb, updated_at = now() WHERE id = $2 RETURNING ai_config',
    [JSON.stringify(limpo), clienteId]);
  if (!rows[0]) throw new ErroDominio('Cliente nao encontrado', 404);
  return { ...AI_CONFIG_PADRAO, ...(rows[0].ai_config || {}) };
}

async function acoesHoje(client) {
  const { rows: todas } = await client.query(`
    SELECT id, nome, empresa, etapa, valor_estimado, proxima_acao, proxima_acao_data
    FROM clientes
    WHERE resultado = 'em_aberto' AND proxima_acao_data IS NOT NULL AND proxima_acao_data <> ''
    ORDER BY proxima_acao_data ASC
  `);
  const hojeStr = new Date().toLocaleDateString('en-CA');
  return {
    atrasados: todas.filter(c => c.proxima_acao_data < hojeStr),
    hoje: todas.filter(c => c.proxima_acao_data === hojeStr),
    futuros: todas.filter(c => c.proxima_acao_data > hojeStr),
  };
}

module.exports = {
  ETAPAS, RESULTADOS, TIPOS_DOC, ErroDominio, montaCliente,
  listarClientes, obterCliente, criarCliente, atualizarCliente, moverEtapa,
  listarInteracoes, registrarInteracao, registrarInteracaoTipo, exportarCliente, excluirCliente, acoesHoje,
  listarDocumentos, obterDocumento, criarDocumento, excluirDocumento,
  obterAiConfig, atualizarAiConfig,
};
