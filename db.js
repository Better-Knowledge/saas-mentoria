/*
 * Mini CRM — Consultoria & IA Generativa
 * Copyright (c) 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licenciado sob a licença MIT. O texto completo está em LICENSE, na raiz do projeto.
 * SPDX-License-Identifier: MIT
 */
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

// ===== FEATURE 002 — RESUMO AUTOMÁTICO DE REUNIÃO =====
// Todas aditivas e idempotentes: criar tabela nova nunca toca em dado existente.

db.exec(`
-- Rascunho da extração, entre a chamada ao modelo e a decisão humana.
-- NÃO é conteúdo do cliente: some ao ser confirmado ou descartado.
CREATE TABLE IF NOT EXISTS resumo_rascunhos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  payload TEXT NOT NULL,                  -- JSON: resumo, decisoes, proximos_passos, objecoes
  transcricao_texto TEXT NOT NULL,        -- ainda nao promovida a tabela transcricoes
  dono_tipo TEXT NOT NULL,                -- humano | ia (de qual plano de credencial nasceu)
  dono_id INTEGER NOT NULL,               -- usuarios.id ou api_keys.id, conforme dono_tipo
  modelo TEXT,                            -- rastreabilidade: quem produziu
  tokens_entrada INTEGER,
  tokens_saida INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rascunho_dono ON resumo_rascunhos(dono_tipo, dono_id, created_at);

-- Transcrição de origem, retida por 90 dias. cliente_id é redundante de propósito:
-- a rotina de purga varre por data sem precisar de join.
CREATE TABLE IF NOT EXISTS transcricoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interacao_id INTEGER NOT NULL UNIQUE,
  cliente_id INTEGER NOT NULL,
  texto TEXT NOT NULL,
  expira_em TEXT NOT NULL,                -- data da gravação + 90 dias, calculada aqui
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (interacao_id) REFERENCES interacoes(id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transcricao_expira ON transcricoes(expira_em);

-- Trilha de auditoria (PRD RF-84, schema do PRD 8.2 — não é desenho novo).
-- SEM FK para clientes de propósito: o registro precisa sobreviver à exclusão do
-- cliente. Apagar o dado pessoal é direito do titular; apagar a prova de que ele
-- foi apagado, não. Por isso valor_anterior/valor_novo nunca guardam dado pessoal.
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade TEXT NOT NULL,                 -- cliente | interacao | usuario | api_key
  entidade_id INTEGER NOT NULL,
  acao TEXT NOT NULL,                     -- criar | atualizar | excluir
  campo TEXT,                             -- NULL em criar/excluir
  valor_anterior TEXT,
  valor_novo TEXT,
  autor TEXT NOT NULL,                    -- humano | ia
  credencial TEXT NOT NULL,               -- sessao | apikey
  credencial_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entidade ON auditoria(entidade, entidade_id, created_at);
`);

// Colunas aditivas em interacoes.
// gerado_por_ia responde "quem escreveu"; revisao responde uma pergunta
// diferente — "alguém conferiu antes de salvar". As duas juntas produzem os três
// estados que a ficha exibe (humano / IA revisada / IA sem revisão).
// duracao_ms no rascunho: SC-002 exige 95% das extrações em ate 30 s, e sem o tempo
// medido esse criterio nao tem como ser verificado.
if (!temColuna('resumo_rascunhos', 'duracao_ms')) {
  db.exec('ALTER TABLE resumo_rascunhos ADD COLUMN duracao_ms INTEGER');
  console.log('[migracao] coluna resumo_rascunhos.duracao_ms criada.');
}

const COLUNAS_INTERACOES = {
  revisao: 'TEXT',            // humana | sem_revisao | NULL (interação comum)
  revisado_por: 'INTEGER',    // usuarios.id de quem confirmou
  revisado_em: 'TEXT',
  origem_registro: 'TEXT',    // 'resumo_reuniao' nas criadas pela feature 002
};
for (const [coluna, tipo] of Object.entries(COLUNAS_INTERACOES)) {
  if (!temColuna('interacoes', coluna)) {
    db.exec(`ALTER TABLE interacoes ADD COLUMN ${coluna} ${tipo}`);
    console.log(`[migracao] coluna interacoes.${coluna} criada.`);
  }
}

module.exports = db;
