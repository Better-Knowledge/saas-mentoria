// server.js — API REST + serve o frontend
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Segurança de transporte / cabeçalhos ----
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"], // app usa handlers inline (onclick)
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  hsts: process.env.NODE_ENV === 'production', // ativar atrás de HTTPS
}));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// limite geral + limite específico para login (anti brute force)
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600 }));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { erro: 'Muitas tentativas. Tente mais tarde.' } });

// ---- Constantes de domínio ----
const ETAPAS = ['novo', 'qualificacao', 'reuniao', 'proposta'];
const RESULTADOS = ['em_aberto', 'ganho', 'perdido'];

// quem é o autor de uma escrita (auditoria confiável, derivada da credencial)
const autorDe = (req) => (req.principal.tipo === 'humano' ? 'humano' : 'ia');

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

// =================== AUTENTICAÇÃO ===================
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, senha } = req.body || {};
  const u = auth.buscarUsuarioPorEmail(email);
  if (!u || !auth.verificarSenha(senha || '', u.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  }
  const { token, csrf } = auth.criarSessao(u.id);
  auth.setCookieSessao(res, token);
  res.json({ usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel }, csrf });
});

app.post('/api/auth/logout', auth.requireAuth, (req, res) => {
  if (req.cookies && req.cookies[auth.COOKIE_NOME]) auth.destruirSessao(req.cookies[auth.COOKIE_NOME]);
  auth.limparCookieSessao(res);
  res.json({ ok: true });
});

// quem sou eu (a UI chama no carregamento p/ saber se há sessão)
app.get('/api/auth/me', (req, res) => {
  const s = auth.obterSessao(req.cookies && req.cookies[auth.COOKIE_NOME]);
  if (!s) return res.status(401).json({ erro: 'Não autenticado' });
  res.json({ usuario: { id: s.usuario_id, nome: s.nome, email: s.email, papel: s.papel }, csrf: s.csrf });
});

// =================== API KEYS (somente admin, via sessão) ===================
app.get('/api/keys', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(auth.listarApiKeys());
});
app.post('/api/keys', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, (req, res) => {
  const nome = (req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'Dê um nome para a integração' });
  const k = auth.criarApiKey({ nome, criadaPor: req.principal.id });
  res.status(201).json(k); // inclui a chave em texto — mostrada UMA vez
});
app.delete('/api/keys/:id', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, (req, res) => {
  const n = auth.revogarApiKey(req.params.id);
  if (!n) return res.status(404).json({ erro: 'Chave não encontrada' });
  res.json({ ok: true });
});

// =================== CLIENTES (tudo protegido) ===================
app.get('/api/clientes', auth.requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM interacoes i WHERE i.cliente_id = c.id) AS total_interacoes
    FROM clientes c ORDER BY c.updated_at DESC
  `).all();
  res.json(rows);
});

app.get('/api/clientes/:id', auth.requireAuth, (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ erro: 'Cliente nao encontrado' });
  cliente.interacoes = db.prepare(
    'SELECT * FROM interacoes WHERE cliente_id = ? ORDER BY data DESC'
  ).all(req.params.id);
  res.json(cliente);
});

app.post('/api/clientes', auth.requireAuth, auth.csrfProtect, (req, res) => {
  const c = montaCliente(req.body);
  if (!c.nome) return res.status(400).json({ erro: 'O campo nome e obrigatorio' });
  const info = db.prepare(`
    INSERT INTO clientes
      (nome, empresa, cargo, telefone, email, tipo_cliente, origem, etapa, resultado,
       valor_estimado, proposta_enviada, status_pagamento, proxima_acao, proxima_acao_data, created_by)
    VALUES
      (@nome, @empresa, @cargo, @telefone, @email, @tipo_cliente, @origem, @etapa, @resultado,
       @valor_estimado, @proposta_enviada, @status_pagamento, @proxima_acao, @proxima_acao_data, @created_by)
  `).run({ ...c, created_by: autorDe(req) });
  res.status(201).json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/clientes/:id', auth.requireAuth, auth.csrfProtect, (req, res) => {
  const existente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ erro: 'Cliente nao encontrado' });
  const c = montaCliente({ ...existente, ...req.body });
  db.prepare(`
    UPDATE clientes SET
      nome=@nome, empresa=@empresa, cargo=@cargo, telefone=@telefone, email=@email,
      tipo_cliente=@tipo_cliente, origem=@origem, etapa=@etapa, resultado=@resultado,
      valor_estimado=@valor_estimado, proposta_enviada=@proposta_enviada,
      status_pagamento=@status_pagamento, proxima_acao=@proxima_acao,
      proxima_acao_data=@proxima_acao_data, updated_at=datetime('now','localtime')
    WHERE id=@id
  `).run({ ...c, id: req.params.id });
  res.json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id));
});

app.put('/api/clientes/:id/etapa', auth.requireAuth, auth.csrfProtect, (req, res) => {
  const { etapa, resultado } = req.body;
  if (etapa && !ETAPAS.includes(etapa)) return res.status(400).json({ erro: 'Etapa invalida' });
  if (resultado && !RESULTADOS.includes(resultado)) return res.status(400).json({ erro: 'Resultado invalido' });
  const existente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ erro: 'Cliente nao encontrado' });
  db.prepare(`
    UPDATE clientes SET etapa = COALESCE(?, etapa), resultado = COALESCE(?, resultado),
      updated_at = datetime('now','localtime') WHERE id = ?
  `).run(etapa || null, resultado || null, req.params.id);
  res.json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id));
});

// LGPD: exportar (agora protegido)
app.get('/api/clientes/:id/export', auth.requireAuth, (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ erro: 'Cliente nao encontrado' });
  cliente.interacoes = db.prepare('SELECT * FROM interacoes WHERE cliente_id = ?').all(req.params.id);
  res.setHeader('Content-Disposition', `attachment; filename="cliente-${req.params.id}.json"`);
  res.json(cliente);
});

// LGPD: excluir
app.delete('/api/clientes/:id', auth.requireAuth, auth.csrfProtect, (req, res) => {
  const info = db.prepare('DELETE FROM clientes WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ erro: 'Cliente nao encontrado' });
  res.json({ ok: true, removido: Number(req.params.id) });
});

// =================== INTERACOES ===================
app.get('/api/clientes/:id/interacoes', auth.requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM interacoes WHERE cliente_id = ? ORDER BY data DESC').all(req.params.id));
});

app.post('/api/clientes/:id/interacoes', auth.requireAuth, auth.csrfProtect, (req, res) => {
  const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ erro: 'Cliente nao encontrado' });
  const texto = (req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'O campo texto e obrigatorio' });
  if (texto.length > 5000) return res.status(400).json({ erro: 'Texto muito longo' });
  const gerado_por_ia = autorDe(req) === 'ia' ? 1 : 0;
  const info = db.prepare(
    'INSERT INTO interacoes (cliente_id, texto, gerado_por_ia) VALUES (?, ?, ?)'
  ).run(req.params.id, texto, gerado_por_ia);
  db.prepare("UPDATE clientes SET updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
  res.status(201).json(db.prepare('SELECT * FROM interacoes WHERE id = ?').get(info.lastInsertRowid));
});

// =================== TELA "HOJE" ===================
app.get('/api/hoje', auth.requireAuth, (req, res) => {
  const todas = db.prepare(`
    SELECT id, nome, empresa, etapa, valor_estimado, proxima_acao, proxima_acao_data
    FROM clientes
    WHERE resultado = 'em_aberto'
      AND proxima_acao_data IS NOT NULL AND proxima_acao_data != ''
    ORDER BY proxima_acao_data ASC
  `).all();
  const hojeStr = new Date().toLocaleDateString('en-CA');
  res.json({
    atrasados: todas.filter(c => c.proxima_acao_data < hojeStr),
    hoje: todas.filter(c => c.proxima_acao_data === hojeStr),
    futuros: todas.filter(c => c.proxima_acao_data > hojeStr),
  });
});

// ---- arquivos estáticos (front) ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- handler global de erros (não derruba o processo) ----
app.use((err, req, res, next) => {
  console.error('Erro:', err.message);
  res.status(500).json({ erro: 'Erro interno' });
});

auth.bootstrapAdmin();
app.listen(PORT, () => console.log(`Mini CRM rodando em http://localhost:${PORT}`));
