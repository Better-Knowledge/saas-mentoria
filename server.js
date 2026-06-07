// server.js — API REST multi-tenant + frontend + servidor MCP autenticado (/mcp), por organização.
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
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  hsts: process.env.NODE_ENV === 'production',
}));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600 }));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { erro: 'Muitas tentativas. Tente mais tarde.' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, message: { erro: 'Muitas requisições. Tente mais tarde.' } });

// Envolve um handler async e encaminha erros ao handler global.
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Roda fn(client) no contexto da organização do principal (RLS).
const comOrg = (req, fn) => db.withOrg(req.principal.org_id, fn);
// Autor de uma escrita (auditoria derivada da credencial).
const autorDe = (req) => (req.principal.tipo === 'humano' ? 'humano' : 'ia');

// =================== AUTENTICAÇÃO / CONTAS ===================
app.post('/api/auth/signup', loginLimiter, asyncH(async (req, res) => {
  const { nome, email, senha, nome_org } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Preencha nome, e-mail e senha' });
  if (String(senha).length < 8) return res.status(400).json({ erro: 'A senha deve ter ao menos 8 caracteres' });
  const { usuario, org } = await auth.signup({ nome, email, senha, nomeOrg: nome_org });
  const { token, csrf } = await auth.criarSessao(usuario.id, org.id);
  auth.setCookieSessao(res, token);
  res.status(201).json({ usuario, org: { ...org, papel: 'owner' }, csrf });
}));

app.post('/api/auth/login', loginLimiter, asyncH(async (req, res) => {
  const { email, senha } = req.body || {};
  const u = await auth.buscarUsuarioPorEmail(email);
  if (!u || !auth.verificarSenha(senha || '', u.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  }
  const orgs = await auth.orgsDoUsuario(u.id);
  const orgAtiva = orgs[0] ? orgs[0].id : null;
  const { token, csrf } = await auth.criarSessao(u.id, orgAtiva);
  auth.setCookieSessao(res, token);
  res.json({ usuario: { id: u.id, nome: u.nome, email: u.email }, org: orgs[0] || null, csrf });
}));

app.post('/api/auth/logout', auth.requireAuth, asyncH(async (req, res) => {
  if (req.cookies && req.cookies[auth.COOKIE_NOME]) await auth.destruirSessao(req.cookies[auth.COOKIE_NOME]);
  auth.limparCookieSessao(res);
  res.json({ ok: true });
}));

// quem sou eu (a UI chama no carregamento)
app.get('/api/auth/me', asyncH(async (req, res) => {
  const s = await auth.obterSessao(req.cookies && req.cookies[auth.COOKIE_NOME]);
  if (!s) return res.status(401).json({ erro: 'Não autenticado' });
  res.json({
    usuario: { id: s.usuario_id, nome: s.nome, email: s.email },
    org: { id: s.org_ativa, papel: s.papel },
    csrf: s.csrf,
  });
}));

// organizações do usuário + troca de organização ativa
app.get('/api/orgs', auth.requireAuth, asyncH(async (req, res) => {
  res.json(await auth.orgsDoUsuario(req.principal.id));
}));
app.post('/api/orgs/ativa', auth.requireAuth, auth.csrfProtect, asyncH(async (req, res) => {
  const orgId = (req.body || {}).org_id;
  const orgs = await auth.orgsDoUsuario(req.principal.id);
  if (!orgs.find((o) => o.id === orgId)) return res.status(403).json({ erro: 'Sem acesso a essa organização' });
  await auth.trocarOrgAtiva(req.cookies[auth.COOKIE_NOME], orgId);
  res.json({ ok: true });
}));

// =================== API KEYS (admin da org, via sessão) ===================
app.get('/api/keys', auth.requireAuth, auth.requireAdmin, asyncH(async (req, res) => {
  res.json(await auth.listarApiKeys(req.principal.org_id));
}));
app.post('/api/keys', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, asyncH(async (req, res) => {
  const nome = (req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'Dê um nome para a integração' });
  res.status(201).json(await auth.criarApiKey({ nome, orgId: req.principal.org_id, criadaPor: req.principal.id }));
}));
app.delete('/api/keys/:id', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, asyncH(async (req, res) => {
  const n = await auth.revogarApiKey(req.principal.org_id, req.params.id);
  if (!n) return res.status(404).json({ erro: 'Chave não encontrada' });
  res.json({ ok: true });
}));

// =================== CLIENTES (delega ao crm-service, dentro de withOrg) ===================
app.get('/api/clientes', auth.requireAuth, asyncH(async (req, res) => {
  res.json(await comOrg(req, (c) => crm.listarClientes(c)));
}));
app.get('/api/clientes/:id', auth.requireAuth, asyncH(async (req, res) => {
  res.json(await comOrg(req, (c) => crm.obterCliente(c, req.params.id)));
}));
app.post('/api/clientes', auth.requireAuth, auth.csrfProtect, asyncH(async (req, res) => {
  res.status(201).json(await comOrg(req, (c) => crm.criarCliente(c, req.body, autorDe(req))));
}));
app.put('/api/clientes/:id', auth.requireAuth, auth.csrfProtect, asyncH(async (req, res) => {
  res.json(await comOrg(req, (c) => crm.atualizarCliente(c, req.params.id, req.body)));
}));
app.put('/api/clientes/:id/etapa', auth.requireAuth, auth.csrfProtect, asyncH(async (req, res) => {
  res.json(await comOrg(req, (c) => crm.moverEtapa(c, req.params.id, req.body || {})));
}));
app.get('/api/clientes/:id/export', auth.requireAuth, asyncH(async (req, res) => {
  const cliente = await comOrg(req, (c) => crm.exportarCliente(c, req.params.id));
  res.setHeader('Content-Disposition', `attachment; filename="cliente-${req.params.id}.json"`);
  res.json(cliente);
}));
app.delete('/api/clientes/:id', auth.requireAuth, auth.csrfProtect, asyncH(async (req, res) => {
  res.json(await comOrg(req, (c) => crm.excluirCliente(c, req.params.id)));
}));

// =================== INTERACOES ===================
app.get('/api/clientes/:id/interacoes', auth.requireAuth, asyncH(async (req, res) => {
  res.json(await comOrg(req, (c) => crm.listarInteracoes(c, req.params.id)));
}));
app.post('/api/clientes/:id/interacoes', auth.requireAuth, auth.csrfProtect, asyncH(async (req, res) => {
  res.status(201).json(await comOrg(req, (c) => crm.registrarInteracao(c, req.params.id, req.body.texto, autorDe(req))));
}));

// =================== TELA "HOJE" ===================
app.get('/api/hoje', auth.requireAuth, asyncH(async (req, res) => {
  res.json(await comOrg(req, (c) => crm.acoesHoje(c)));
}));

// ---- documentação da API ----
app.get('/openapi.yaml', (req, res) => res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.yaml')));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'SaaS Mentoria — API' }));

// ---- bootstrap assíncrono: MCP (ESM) + estáticos + erro + listen ----
async function iniciar() {
  const { criarHandlerMcp } = await import('./mcp/server.mjs');
  const handlerMcp = criarHandlerMcp({ crmService: crm, withOrg: db.withOrg });
  app.post('/mcp', mcpLimiter, auth.requireBearer, (req, res) => handlerMcp(req, res));

  app.use(express.static(path.join(__dirname, 'public')));

  // Handler global de erros: erros de domínio (crm) e de auth carregam `status` (<500 → negócio).
  app.use((err, req, res, next) => {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    if (status < 500) return res.status(status).json({ erro: err.message });
    console.error('Erro:', err && err.message);
    res.status(500).json({ erro: 'Erro interno' });
  });

  await auth.bootstrapInicial();
  app.listen(PORT, () => console.log(`SaaS Mentoria rodando em http://localhost:${PORT}`));
}

iniciar().catch((e) => {
  console.error('Falha ao iniciar:', e);
  process.exit(1);
});
