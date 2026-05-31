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
