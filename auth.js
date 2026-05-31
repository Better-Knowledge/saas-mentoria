// auth.js — autenticação em dois planos:
//   A) Pessoas (UI): login com e-mail + senha → sessão em cookie httpOnly + CSRF
//   B) Máquinas (IA): API keys próprias, revogáveis, via Authorization: Bearer
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const COOKIE_NOME = 'crm_sessao';
const DIAS_SESSAO = 7;
const ehProducao = process.env.NODE_ENV === 'production';

// ---------- helpers de senha ----------
function hashSenha(senha) { return bcrypt.hashSync(senha, 12); }
function verificarSenha(senha, hash) { return bcrypt.compareSync(senha, hash); }

// ---------- helpers gerais ----------
function tokenAleatorio(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
// comparação em tempo constante (evita timing attack)
function igualSeguro(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ---------- usuários ----------
function criarUsuario({ nome, email, senha, papel = 'admin' }) {
  const info = db.prepare(
    'INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)'
  ).run(nome, email.toLowerCase().trim(), hashSenha(senha), papel);
  return db.prepare('SELECT id, nome, email, papel FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
}
function buscarUsuarioPorEmail(email) {
  return db.prepare('SELECT * FROM usuarios WHERE email = ?').get((email || '').toLowerCase().trim());
}
function contarUsuarios() { return db.prepare('SELECT COUNT(*) n FROM usuarios').get().n; }

// ---------- sessões ----------
function criarSessao(usuarioId) {
  const token = tokenAleatorio();
  const csrf = tokenAleatorio(24);
  const expira = new Date(Date.now() + DIAS_SESSAO * 864e5).toISOString();
  db.prepare('INSERT INTO sessoes (token, usuario_id, csrf, expira_em) VALUES (?, ?, ?, ?)')
    .run(token, usuarioId, csrf, expira);
  return { token, csrf };
}
function obterSessao(token) {
  if (!token) return null;
  const s = db.prepare(`
    SELECT s.token, s.usuario_id, s.csrf, s.expira_em, u.nome, u.email, u.papel
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ?
  `).get(token);
  if (!s) return null;
  if (new Date(s.expira_em) < new Date()) { destruirSessao(token); return null; }
  return s;
}
function destruirSessao(token) { db.prepare('DELETE FROM sessoes WHERE token = ?').run(token); }

function setCookieSessao(res, token) {
  res.cookie(COOKIE_NOME, token, {
    httpOnly: true,
    secure: ehProducao,            // exige HTTPS em produção
    sameSite: 'lax',
    maxAge: DIAS_SESSAO * 864e5,
    path: '/',
  });
}
function limparCookieSessao(res) { res.clearCookie(COOKIE_NOME, { path: '/' }); }

// ---------- API keys ----------
function criarApiKey({ nome, criadaPor }) {
  const segredo = 'crm_' + tokenAleatorio(24);     // mostrada UMA vez
  const prefixo = segredo.slice(0, 12);
  const info = db.prepare(
    'INSERT INTO api_keys (nome, prefixo, key_hash, criada_por) VALUES (?, ?, ?, ?)'
  ).run(nome, prefixo, sha256(segredo), criadaPor || null);
  return { id: info.lastInsertRowid, nome, prefixo, chave: segredo };
}
function listarApiKeys() {
  return db.prepare(
    'SELECT id, nome, prefixo, ativa, ultimo_uso, created_at FROM api_keys ORDER BY created_at DESC'
  ).all();
}
function revogarApiKey(id) { return db.prepare('UPDATE api_keys SET ativa = 0 WHERE id = ?').run(id).changes; }
function verificarApiKey(chave) {
  if (!chave) return null;
  const k = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND ativa = 1').get(sha256(chave));
  if (!k) return null;
  db.prepare("UPDATE api_keys SET ultimo_uso = datetime('now','localtime') WHERE id = ?").run(k.id);
  return k;
}

// ---------- middlewares ----------
// Aceita sessão (pessoa) OU API key (máquina). Sem isso → 401.
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) {
    const k = verificarApiKey(header.slice(7));
    if (!k) return res.status(401).json({ erro: 'Chave de API inválida ou revogada' });
    req.principal = { tipo: 'ia', credencial: 'apikey', id: k.id, nome: k.nome };
    return next();
  }
  const s = obterSessao(req.cookies && req.cookies[COOKIE_NOME]);
  if (s) {
    req.principal = { tipo: 'humano', credencial: 'sessao', id: s.usuario_id,
      nome: s.nome, papel: s.papel, csrf: s.csrf };
    return next();
  }
  return res.status(401).json({ erro: 'Não autenticado' });
}

// Para escritas vindas do navegador (sessão), exige o token CSRF no header.
// Requisições por API key não usam cookie → não são alvo de CSRF.
function csrfProtect(req, res, next) {
  if (req.principal && req.principal.credencial === 'sessao') {
    const enviado = req.headers['x-csrf-token'];
    if (!enviado || !igualSeguro(enviado, req.principal.csrf)) {
      return res.status(403).json({ erro: 'Token CSRF inválido' });
    }
  }
  next();
}

// Restringe a administradores (pessoas com papel admin).
function requireAdmin(req, res, next) {
  if (!req.principal || req.principal.credencial !== 'sessao' || req.principal.papel !== 'admin') {
    return res.status(403).json({ erro: 'Apenas administradores' });
  }
  next();
}

// Cria o primeiro admin se não houver nenhum usuário.
function bootstrapAdmin() {
  if (contarUsuarios() > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@crm.local';
  const senha = process.env.ADMIN_SENHA || 'mudar123';
  criarUsuario({ nome: 'Administrador', email, senha, papel: 'admin' });
  console.log('========================================================');
  console.log(' Usuário admin criado:');
  console.log('   e-mail: ' + email);
  if (!process.env.ADMIN_SENHA) {
    console.log('   senha:  ' + senha + '   <-- TROQUE! defina ADMIN_SENHA no .env');
  } else {
    console.log('   senha:  (definida em ADMIN_SENHA)');
  }
  console.log('========================================================');
}

module.exports = {
  COOKIE_NOME, verificarSenha,
  criarUsuario, buscarUsuarioPorEmail, contarUsuarios,
  criarSessao, obterSessao, destruirSessao, setCookieSessao, limparCookieSessao,
  criarApiKey, listarApiKeys, revogarApiKey,
  requireAuth, csrfProtect, requireAdmin, bootstrapAdmin,
};
