// auth.js — autenticação multi-tenant em dois planos:
//   A) Pessoas (UI): login/signup → sessão em cookie httpOnly + CSRF, com ORGANIZAÇÃO ATIVA.
//   B) Máquinas (IA): API keys próprias da organização, revogáveis, via Authorization: Bearer.
// PostgreSQL: tabelas de plataforma/auth (usuarios, organizations, memberships, sessoes, api_keys)
// não usam RLS; a chave Bearer carrega o org_id que escopa o agente àquela organização.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, withoutOrg } = require('./db');

const COOKIE_NOME = 'crm_sessao';
const DIAS_SESSAO = 7;
const ehProducao = process.env.NODE_ENV === 'production';

// ---------- helpers de senha / gerais ----------
function hashSenha(senha) { return bcrypt.hashSync(senha, 12); }
function verificarSenha(senha, hash) { return bcrypt.compareSync(senha, hash); }
function tokenAleatorio(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function igualSeguro(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function erro(msg, status) { const e = new Error(msg); e.status = status; return e; }

// ---------- usuários ----------
async function buscarUsuarioPorEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM usuarios WHERE email = $1', [(email || '').toLowerCase().trim()]
  );
  return rows[0] || null;
}

// ---------- signup: cria usuário + organização + membership(owner) ----------
async function signup({ nome, email, senha, nomeOrg }) {
  const em = (email || '').toLowerCase().trim();
  if (!nome || !em || !senha) throw erro('Preencha nome, e-mail e senha', 400);
  return withoutOrg(async (client) => {
    await client.query('BEGIN');
    try {
      const { rows: ex } = await client.query('SELECT id FROM usuarios WHERE email = $1', [em]);
      if (ex[0]) throw erro('E-mail já cadastrado', 409);
      const usuario = (await client.query(
        'INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1,$2,$3) RETURNING id, nome, email',
        [String(nome).trim(), em, hashSenha(senha)]
      )).rows[0];
      const org = (await client.query(
        'INSERT INTO organizations (nome) VALUES ($1) RETURNING id, nome',
        [String(nomeOrg || nome || 'Minha empresa').trim()]
      )).rows[0];
      await client.query(
        "INSERT INTO memberships (usuario_id, org_id, papel) VALUES ($1,$2,'owner')",
        [usuario.id, org.id]
      );
      await client.query('COMMIT');
      return { usuario, org };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
}

// organizações de um usuário (com o papel em cada uma)
async function orgsDoUsuario(usuarioId) {
  const { rows } = await pool.query(`
    SELECT o.id, o.nome, m.papel
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.usuario_id = $1 ORDER BY m.created_at ASC`, [usuarioId]);
  return rows;
}

// ---------- sessões (com organização ativa) ----------
async function criarSessao(usuarioId, orgId) {
  const token = tokenAleatorio();
  const csrf = tokenAleatorio(24);
  const expira = new Date(Date.now() + DIAS_SESSAO * 864e5).toISOString();
  await pool.query(
    'INSERT INTO sessoes (token, usuario_id, org_ativa, csrf, expira_em) VALUES ($1,$2,$3,$4,$5)',
    [token, usuarioId, orgId || null, csrf, expira]
  );
  return { token, csrf };
}
async function obterSessao(token) {
  if (!token) return null;
  const { rows } = await pool.query(`
    SELECT s.token, s.usuario_id, s.csrf, s.expira_em, s.org_ativa,
           u.nome, u.email, m.papel
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    LEFT JOIN memberships m ON m.usuario_id = s.usuario_id AND m.org_id = s.org_ativa
    WHERE s.token = $1`, [token]);
  const s = rows[0];
  if (!s) return null;
  if (new Date(s.expira_em) < new Date()) { await destruirSessao(token); return null; }
  return s;
}
async function destruirSessao(token) { await pool.query('DELETE FROM sessoes WHERE token = $1', [token]); }
async function trocarOrgAtiva(token, orgId) {
  await pool.query('UPDATE sessoes SET org_ativa = $1 WHERE token = $2', [orgId, token]);
}

function setCookieSessao(res, token) {
  res.cookie(COOKIE_NOME, token, {
    httpOnly: true, secure: ehProducao, sameSite: 'lax', maxAge: DIAS_SESSAO * 864e5, path: '/',
  });
}
function limparCookieSessao(res) { res.clearCookie(COOKIE_NOME, { path: '/' }); }

// ---------- API keys (escopadas à organização) ----------
async function criarApiKey({ nome, orgId, criadaPor }) {
  const segredo = 'crm_' + tokenAleatorio(24);     // mostrada UMA vez
  const prefixo = segredo.slice(0, 12);
  const { rows } = await pool.query(
    'INSERT INTO api_keys (org_id, nome, prefixo, key_hash, criada_por) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [orgId, nome, prefixo, sha256(segredo), criadaPor || null]
  );
  return { id: rows[0].id, nome, prefixo, chave: segredo };
}
async function listarApiKeys(orgId) {
  return (await pool.query(
    'SELECT id, nome, prefixo, ativa, ultimo_uso, created_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC',
    [orgId]
  )).rows;
}
async function revogarApiKey(orgId, id) {
  return (await pool.query(
    'UPDATE api_keys SET ativa = false WHERE id = $1 AND org_id = $2', [id, orgId]
  )).rowCount;
}
// Lookup global por key_hash (a credencial é a fonte de verdade da org → carrega o org_id adiante).
async function verificarApiKey(chave) {
  if (!chave) return null;
  const { rows } = await pool.query(
    'SELECT id, nome, org_id FROM api_keys WHERE key_hash = $1 AND ativa = true', [sha256(chave)]
  );
  const k = rows[0];
  if (!k) return null;
  await pool.query('UPDATE api_keys SET ultimo_uso = now() WHERE id = $1', [k.id]);
  return k;
}

// ---------- middlewares ----------
// Aceita sessão (pessoa) OU API key (máquina). Ambos resolvem org_id. Sem isso → 401.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    if (header.startsWith('Bearer ')) {
      const k = await verificarApiKey(header.slice(7));
      if (!k) return res.status(401).json({ erro: 'Chave de API inválida ou revogada' });
      req.principal = { tipo: 'ia', credencial: 'apikey', id: k.id, nome: k.nome, org_id: k.org_id };
      return next();
    }
    const s = await obterSessao(req.cookies && req.cookies[COOKIE_NOME]);
    if (s) {
      if (!s.org_ativa) return res.status(403).json({ erro: 'Sem organização ativa' });
      req.principal = {
        tipo: 'humano', credencial: 'sessao', id: s.usuario_id, nome: s.nome,
        papel: s.papel, org_id: s.org_ativa, csrf: s.csrf,
      };
      return next();
    }
    return res.status(401).json({ erro: 'Não autenticado' });
  } catch (e) { next(e); }
}

// CSRF nas escritas de sessão (API key não usa cookie → não é alvo).
function csrfProtect(req, res, next) {
  if (req.principal && req.principal.credencial === 'sessao') {
    const enviado = req.headers['x-csrf-token'];
    if (!enviado || !igualSeguro(enviado, req.principal.csrf)) {
      return res.status(403).json({ erro: 'Token CSRF inválido' });
    }
  }
  next();
}

// Restringe a quem administra a organização (owner/admin via sessão).
function requireAdmin(req, res, next) {
  if (!req.principal || req.principal.credencial !== 'sessao'
      || !['owner', 'admin'].includes(req.principal.papel)) {
    return res.status(403).json({ erro: 'Apenas administradores da organização' });
  }
  next();
}

// Resolução de credencial do MCP (isolada para no futuro plugar OAuth sem quebrar as chaves).
async function resolverPrincipal(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) {
    const k = await verificarApiKey(header.slice(7));
    if (k) return { tipo: 'ia', credencial: 'apikey', id: k.id, nome: k.nome, org_id: k.org_id };
  }
  return null;
}
// Exige Bearer válido para o /mcp. Sem credencial válida → 401 (nunca anônimo).
async function requireBearer(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado' });
    const principal = await resolverPrincipal(req);
    if (!principal) return res.status(401).json({ erro: 'Chave de API inválida ou revogada' });
    req.principal = principal;
    next();
  } catch (e) { next(e); }
}

// Cria a organização inicial + admin (owner) a partir do .env, se ainda não houver organização.
async function bootstrapInicial() {
  const n = (await pool.query('SELECT COUNT(*)::int AS n FROM organizations')).rows[0].n;
  if (n > 0) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@saas.local').toLowerCase().trim();
  const senha = process.env.ADMIN_SENHA || 'mudar123';
  const nomeOrg = process.env.ADMIN_ORG || 'Minha empresa';
  await signup({ nome: 'Administrador', email, senha, nomeOrg });
  console.log('========================================================');
  console.log(' Organização inicial + admin (owner) criados:');
  console.log('   e-mail: ' + email);
  console.log('   org:    ' + nomeOrg);
  if (!process.env.ADMIN_SENHA) console.log('   senha:  ' + senha + '   <-- TROQUE! defina ADMIN_SENHA no .env');
  console.log('========================================================');
}

module.exports = {
  COOKIE_NOME, verificarSenha,
  buscarUsuarioPorEmail, signup, orgsDoUsuario,
  criarSessao, obterSessao, destruirSessao, trocarOrgAtiva, setCookieSessao, limparCookieSessao,
  criarApiKey, listarApiKeys, revogarApiKey, verificarApiKey,
  requireAuth, csrfProtect, requireAdmin, resolverPrincipal, requireBearer,
  bootstrapInicial,
};
