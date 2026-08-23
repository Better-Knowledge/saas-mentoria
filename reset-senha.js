/*
 * Copyright 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// reset-senha.js — redefine a senha do admin a partir do .env
// Uso: node reset-senha.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const email = (process.env.ADMIN_EMAIL || 'admin@crm.local').toLowerCase().trim();
const senha = process.env.ADMIN_SENHA;

if (!senha) {
  console.error('Defina ADMIN_SENHA no .env antes de rodar.');
  process.exit(1);
}

const hash = bcrypt.hashSync(senha, 12);
const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);

if (existe) {
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE email = ?').run(hash, email);
  // encerra sessões antigas por segurança
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(existe.id);
  console.log(`Senha atualizada para ${email}. Sessões antigas encerradas.`);
} else {
  db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)')
    .run('Administrador', email, hash, 'admin');
  console.log(`Usuário ${email} criado como admin.`);
}
