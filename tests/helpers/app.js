// tests/helpers/app.js — bootstrap das suítes.
//
// DATA_DIR é apontado para um diretório temporário ANTES de qualquer require dos
// módulos do app, porque db.js abre a conexão no momento em que é carregado. Cada
// arquivo de teste roda em processo próprio (node --test), então cada um ganha um
// banco limpo e independente.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY;   // nenhum teste chama a API paga
process.env.ADMIN_EMAIL = 'admin@teste.local';
process.env.ADMIN_SENHA = 'senha-de-teste-123';

const request = require('supertest');
const db = require('../../db');
const auth = require('../../auth');
const crm = require('../../crm-service');

let appPromise = null;
function app() {
  if (!appPromise) appPromise = require('../../server').criarApp();
  return appPromise;
}

// Sessão de pessoa: devolve o agente do supertest já com cookie, mais o token CSRF.
//
// Memoizada de propósito. O produto limita o login a 10 tentativas por 15 minutos
// (anti brute force, RNF-03), e uma suíte que loga a cada teste bate nesse limite e
// falha por 429 — o limite fazendo o trabalho dele. Uma sessão por arquivo de teste
// também é mais fiel ao uso real: a pessoa loga uma vez e trabalha.
let sessaoCache = null;
async function logar({ novo = false } = {}) {
  if (sessaoCache && !novo) return sessaoCache;
  const a = await app();
  const agente = request.agent(a);
  const r = await agente.post('/api/auth/login')
    .send({ email: process.env.ADMIN_EMAIL, senha: process.env.ADMIN_SENHA })
    .expect(200);
  const sessao = { agente, csrf: r.body.csrf, usuario: r.body.usuario };
  if (!novo) sessaoCache = sessao;
  return sessao;
}

// Credencial de máquina.
function criarChave(nome = 'teste') {
  const admin = db.prepare('SELECT id FROM usuarios ORDER BY id LIMIT 1').get();
  return auth.criarApiKey({ nome, criadaPor: admin ? admin.id : null });
}

function criarCliente(nome = 'Cliente de Teste', extras = {}) {
  return crm.criarCliente({ nome, ...extras }, 'humano');
}

// Principais sintéticos para os testes de serviço, que não passam por HTTP.
function principalSessao(id) {
  const u = db.prepare('SELECT id FROM usuarios ORDER BY id LIMIT 1').get();
  return { tipo: 'humano', credencial: 'sessao', id: id ?? (u ? u.id : 1) };
}
function principalChave(id = 1) {
  return { tipo: 'ia', credencial: 'apikey', id };
}

function limpar() {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* melhor esforço */ }
}

module.exports = {
  app, logar, criarChave, criarCliente, principalSessao, principalChave,
  db, auth, crm, request, DATA_DIR: dir, limpar,
};
