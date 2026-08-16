// db.js — conexao com o SQLite e criacao das tabelas (schema)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Diretorio de dados (persistencia). Em Docker apontamos para um volume
// via DATA_DIR; localmente cai no proprio diretorio do projeto.
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'crm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tabela de clientes / negocios.
// etapa: novo | qualificacao | reuniao | proposta
// resultado: em_aberto | ganho | perdido
// tipo_cliente: b2b | autonomo | publico
// created_by: humano | ia  (auditoria LGPD)
db.exec(`
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  empresa TEXT,
  cargo TEXT,
  telefone TEXT,
  email TEXT,
  tipo_cliente TEXT DEFAULT 'b2b',
  origem TEXT,
  etapa TEXT NOT NULL DEFAULT 'novo',
  resultado TEXT NOT NULL DEFAULT 'em_aberto',
  valor_estimado REAL DEFAULT 0,
  proposta_enviada INTEGER DEFAULT 0,
  status_pagamento TEXT,
  proxima_acao TEXT,
  proxima_acao_data TEXT,
  created_by TEXT DEFAULT 'humano',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS interacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  texto TEXT NOT NULL,
  gerado_por_ia INTEGER DEFAULT 0,
  data TEXT DEFAULT (datetime('now','localtime')),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);

-- ===== AUTENTICAÇÃO =====

-- Pessoas que usam a interface
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'admin',          -- admin | assistente
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- Sessões de login (cookie httpOnly aponta para um token aqui)
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  csrf TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Chaves de API para automações/IA (uma por integração, revogável)
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,                            -- rótulo da integração
  prefixo TEXT NOT NULL,                         -- parte visível p/ identificar
  key_hash TEXT NOT NULL,                        -- só o hash é guardado
  ativa INTEGER NOT NULL DEFAULT 1,
  ultimo_uso TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  criada_por INTEGER,
  FOREIGN KEY (criada_por) REFERENCES usuarios(id) ON DELETE SET NULL
);
`);

// ===== MIGRACOES =====
// Aditivas e idempotentes: rodam a cada start e nao tocam em dados existentes.
function temColuna(tabela, coluna) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().some(c => c.name === coluna);
}

// fechado_em: data (YYYY-MM-DD) em que o negocio saiu de "em_aberto".
// Sem ela nao da para medir ganhos/perdas por mes nem ciclo de vendas —
// updated_at nao serve, porque muda a cada edicao do cadastro.
if (!temColuna('clientes', 'fechado_em')) {
  db.exec('ALTER TABLE clientes ADD COLUMN fechado_em TEXT');
  // Retroativo: quem ja estava ganho/perdido nao tem a data real do desfecho.
  // O updated_at e o melhor palpite disponivel — marcado uma unica vez, aqui.
  const info = db.prepare(`
    UPDATE clientes SET fechado_em = date(updated_at)
    WHERE resultado != 'em_aberto' AND fechado_em IS NULL
  `).run();
  console.log(`[migracao] coluna clientes.fechado_em criada; ${info.changes} registro(s) ja fechados receberam date(updated_at) como estimativa.`);
}

module.exports = db;
