/*
 * Mini CRM — Consultoria & IA Generativa
 * Copyright (c) 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licenciado sob a licença MIT. O texto completo está em LICENSE, na raiz do projeto.
 * SPDX-License-Identifier: MIT
 */
// auth.js — autenticação em dois planos:
//   A) Pessoas (UI): login com e-mail + senha → sessão em cookie httpOnly + CSRF
//   B) Máquinas (IA): API keys próprias, revogáveis, via Authorization: Bearer
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const COOKIE_NOME = 'crm_sessao';
const DIAS_SESSAO = 7;
const ehProducao = process.env.NODE_ENV === 'production';

// Papéis possíveis. `admin` administra usuários e chaves de API; `assistente`
// usa o CRM inteiro (criar/editar/excluir clientes) mas não administra nada.
const PAPEIS = ['admin', 'assistente'];
const SENHA_MINIMA = 8;

// Erro de autenticação/gestão com status HTTP, traduzido pelo handler global do
// Express (mesmo contrato do ErroDominio do crm-service).
class ErroAuth extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroAuth';
    this.status = status;
  }
}

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

// ---------- gestão de usuários (multiusuário; só admin chega aqui) ----------
function normalizarEmail(e) { return String(e || '').toLowerCase().trim(); }

function validarEmail(email) {
  if (!email) throw new ErroAuth('Informe o e-mail');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroAuth('E-mail inválido');
}
function validarSenha(senha) {
  if (!senha || String(senha).length < SENHA_MINIMA) {
    throw new ErroAuth(`A senha precisa de pelo menos ${SENHA_MINIMA} caracteres`);
  }
}
function validarPapel(papel) {
  if (!PAPEIS.includes(papel)) throw new ErroAuth('Papel inválido');
}

// Nunca devolve senha_hash.
function listarUsuarios() {
  return db.prepare('SELECT id, nome, email, papel, created_at FROM usuarios ORDER BY id ASC').all();
}
function obterUsuario(id) {
  const u = db.prepare('SELECT id, nome, email, papel, created_at FROM usuarios WHERE id = ?').get(id);
  if (!u) throw new ErroAuth('Usuário não encontrado', 404);
  return u;
}
function contarAdmins() {
  return db.prepare("SELECT COUNT(*) n FROM usuarios WHERE papel = 'admin'").get().n;
}

function cadastrarUsuario({ nome, email, senha, papel = 'assistente' }) {
  const nomeLimpo = String(nome || '').trim();
  const emailLimpo = normalizarEmail(email);
  if (!nomeLimpo) throw new ErroAuth('Informe o nome');
  validarEmail(emailLimpo);
  validarSenha(senha);
  validarPapel(papel);
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(emailLimpo)) {
    throw new ErroAuth('Já existe um usuário com este e-mail', 409);
  }
  return criarUsuario({ nome: nomeLimpo, email: emailLimpo, senha, papel });
}

// Altera nome e/ou papel. O papel é lido do banco a cada requisição (obterSessao
// faz JOIN em usuarios), então a mudança vale na hora, sem derrubar a sessão.
function atualizarUsuario(id, { nome, papel }) {
  const u = obterUsuario(id);
  const novoNome = nome === undefined ? u.nome : String(nome).trim();
  const novoPapel = papel === undefined ? u.papel : papel;
  if (!novoNome) throw new ErroAuth('Informe o nome');
  validarPapel(novoPapel);
  if (u.papel === 'admin' && novoPapel !== 'admin' && contarAdmins() <= 1) {
    throw new ErroAuth('Este é o último administrador — promova outro antes de rebaixá-lo');
  }
  db.prepare('UPDATE usuarios SET nome = ?, papel = ? WHERE id = ?').run(novoNome, novoPapel, u.id);
  return obterUsuario(u.id);
}

// Admin redefine a senha de alguém: derruba TODAS as sessões desse usuário.
function redefinirSenha(id, senha) {
  const u = obterUsuario(id);
  validarSenha(senha);
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(senha), u.id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
  return { ok: true };
}

// Troca da própria senha: exige a senha atual e mantém apenas a sessão em uso
// (as outras caem — se a senha vazou, o invasor perde o acesso).
function trocarPropriaSenha(usuarioId, { senhaAtual, senhaNova }, tokenAtual) {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  if (!u) throw new ErroAuth('Usuário não encontrado', 404);
  if (!verificarSenha(senhaAtual || '', u.senha_hash)) throw new ErroAuth('Senha atual incorreta', 403);
  validarSenha(senhaNova);
  if (senhaNova === senhaAtual) throw new ErroAuth('A nova senha precisa ser diferente da atual');
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(senhaNova), u.id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token != ?').run(u.id, tokenAtual || '');
  return { ok: true };
}

// Exclui um usuário. As sessões caem por ON DELETE CASCADE e as chaves de API
// que ele criou continuam válidas (criada_por vira NULL) — revogue-as à parte.
function excluirUsuario(id, solicitanteId) {
  const u = obterUsuario(id);
  if (Number(u.id) === Number(solicitanteId)) throw new ErroAuth('Você não pode excluir a própria conta');
  if (u.papel === 'admin' && contarAdmins() <= 1) {
    throw new ErroAuth('Não é possível excluir o último administrador');
  }
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(u.id);
  return { ok: true, removido: u.id };
}

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

// ---------- resolução de credencial: dois planos, duas funções ----------
// A separação é deliberada e é uma exigência de segurança, não estilo.
//
// Se uma única função resolvesse os dois planos com fallback interno, ela seria
// insegura no ponto onde é usada por requireBearer: aquele middleware valida apenas
// o PREFIXO do header antes de chamá-la, então uma requisição com
// `Authorization: Bearer <lixo>` acompanhada de um cookie de sessão válido cairia no
// fallback e entraria no endpoint MCP como principal humano — credencial de pessoa
// operando o plano de máquina, num endpoint que não exige CSRF.
//
// Com duas funções, esse vazamento é impossível por construção em vez de depender de
// a ordem das checagens continuar correta para sempre. tests/resumo-api.test.js fixa
// a fronteira.

// Plano B (máquinas): SÓ Authorization: Bearer. Nunca olha cookie.
function resolverBearer(req) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return null;
  const k = verificarApiKey(header.slice(7));
  if (!k) return null;
  return { tipo: 'ia', credencial: 'apikey', id: k.id, nome: k.nome };
}

// Plano A (pessoas): SÓ o cookie de sessão. Nunca olha header Authorization.
function resolverSessao(req) {
  const s = obterSessao(req.cookies && req.cookies[COOKIE_NOME]);
  if (!s) return null;
  return { tipo: 'humano', credencial: 'sessao', id: s.usuario_id,
    nome: s.nome, papel: s.papel, csrf: s.csrf };
}

// Porta única das rotas /api, onde os dois planos são legítimos. A ordem importa:
// um Bearer presente é uma declaração explícita de intenção de operar como máquina,
// e um Bearer inválido NÃO cai para a sessão — devolve null, e a rota responde 401.
function resolverPrincipal(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) return resolverBearer(req);
  return resolverSessao(req);
}

// ---------- middlewares ----------
// Aceita sessão (pessoa) OU API key (máquina). Sem isso → 401.
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const principal = resolverPrincipal(req);
  if (!principal) {
    return res.status(401).json(
      header.startsWith('Bearer ')
        ? { erro: 'Chave de API inválida ou revogada' }
        : { erro: 'Não autenticado' }
    );
  }
  req.principal = principal;
  next();
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

// ---------- autenticação do servidor MCP (plano de máquina) ----------
// Exige Bearer válido. Usa resolverBearer — NUNCA resolverPrincipal — para que um
// cookie de sessão jamais abra o endpoint MCP. Trocar por resolverPrincipal aqui
// reintroduziria o vazamento de plano descrito acima.
//
// O isolamento que o PRD RF-69 pede continua valendo: quando o OAuth do MCP chegar,
// ele é plugado dentro de resolverBearer, sem invalidar as chaves já emitidas.
function requireBearer(req, res, next) {
  const principal = resolverBearer(req);
  if (!principal) {
    const header = req.headers['authorization'] || '';
    return res.status(401).json(
      header.startsWith('Bearer ')
        ? { erro: 'Chave de API inválida ou revogada' }
        : { erro: 'Não autenticado' }
    );
  }
  req.principal = principal;
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
  COOKIE_NOME, PAPEIS, SENHA_MINIMA, ErroAuth, verificarSenha,
  criarUsuario, buscarUsuarioPorEmail, contarUsuarios,
  listarUsuarios, obterUsuario, cadastrarUsuario, atualizarUsuario,
  redefinirSenha, trocarPropriaSenha, excluirUsuario,
  criarSessao, obterSessao, destruirSessao, setCookieSessao, limparCookieSessao,
  criarApiKey, listarApiKeys, revogarApiKey,
  requireAuth, csrfProtect, requireAdmin, bootstrapAdmin,
  resolverPrincipal, resolverBearer, resolverSessao, requireBearer,
};
