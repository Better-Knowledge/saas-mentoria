// server.js — API REST + serve o frontend + servidor MCP autenticado (/mcp)
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
const db = require('./db');
const auth = require('./auth');
const crm = require('./crm-service'); // lógica de domínio compartilhada por REST e MCP

// Spec OpenAPI (carregado do openapi.yaml na raiz do projeto)
const openapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'));

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
      // helmet força script-src-attr 'none' por padrão, o que bloqueia os
      // handlers inline (onclick/ondragstart/ondrop) — precisamos liberar:
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  hsts: process.env.NODE_ENV === 'production', // ativar atrás de HTTPS
}));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// limite geral + limite específico para login (anti brute force) + limite do MCP
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600 }));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { erro: 'Muitas tentativas. Tente mais tarde.' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, message: { erro: 'Muitas requisições. Tente mais tarde.' } });

// quem é o autor de uma escrita (auditoria confiável, derivada da credencial)
const autorDe = (req) => (req.principal.tipo === 'humano' ? 'humano' : 'ia');

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

// =================== CLIENTES (tudo protegido — delega ao crm-service) ===================
app.get('/api/clientes', auth.requireAuth, (req, res) => {
  res.json(crm.listarClientes());
});

app.get('/api/clientes/:id', auth.requireAuth, (req, res) => {
  res.json(crm.obterCliente(req.params.id));
});

app.post('/api/clientes', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.status(201).json(crm.criarCliente(req.body, autorDe(req)));
});

app.put('/api/clientes/:id', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.json(crm.atualizarCliente(req.params.id, req.body));
});

app.put('/api/clientes/:id/etapa', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.json(crm.moverEtapa(req.params.id, req.body || {}));
});

// LGPD: exportar (protegido)
app.get('/api/clientes/:id/export', auth.requireAuth, (req, res) => {
  const cliente = crm.exportarCliente(req.params.id);
  res.setHeader('Content-Disposition', `attachment; filename="cliente-${req.params.id}.json"`);
  res.json(cliente);
});

// LGPD: excluir
app.delete('/api/clientes/:id', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.json(crm.excluirCliente(req.params.id));
});

// =================== INTERACOES ===================
app.get('/api/clientes/:id/interacoes', auth.requireAuth, (req, res) => {
  res.json(crm.listarInteracoes(req.params.id));
});

app.post('/api/clientes/:id/interacoes', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.status(201).json(crm.registrarInteracao(req.params.id, req.body.texto, autorDe(req)));
});

// =================== TELA "HOJE" ===================
app.get('/api/hoje', auth.requireAuth, (req, res) => {
  res.json(crm.acoesHoje());
});

// ---- documentação da API (Swagger UI + spec cru) ----
app.get('/openapi.yaml', (req, res) => {
  res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.yaml'));
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'Mini CRM — API',
}));

// ---- bootstrap assíncrono: monta o servidor MCP (ESM) e só então estáticos + erro + listen ----
async function iniciar() {
  // Servidor MCP autenticado: o módulo é ESM, carregado por import() dinâmico a partir do CommonJS.
  // requireBearer garante que nenhuma ferramenta executa sem credencial válida (sem anônimo).
  const { criarHandlerMcp } = await import('./mcp/server.mjs');
  const handlerMcp = criarHandlerMcp({ crmService: crm });
  app.post('/mcp', mcpLimiter, auth.requireBearer, (req, res) => handlerMcp(req, res));

  // ---- arquivos estáticos (front) ----
  app.use(express.static(path.join(__dirname, 'public')));

  // ---- handler global de erros (não derruba o processo) ----
  app.use((err, req, res, next) => {
    // erros de domínio do crm-service viram 400/404 de negócio (em vez de 500 genérico)
    if (err instanceof crm.ErroDominio) {
      return res.status(err.status).json({ erro: err.message });
    }
    console.error('Erro:', err.message);
    res.status(500).json({ erro: 'Erro interno' });
  });

  auth.bootstrapAdmin();
  app.listen(PORT, () => console.log(`Mini CRM rodando em http://localhost:${PORT}`));
}

iniciar().catch((e) => {
  console.error('Falha ao iniciar:', e);
  process.exit(1);
});
