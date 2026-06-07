// reset-senha.js — redefine a senha do admin (ADMIN_EMAIL) a partir do .env. Uso: node reset-senha.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

(async () => {
  const email = (process.env.ADMIN_EMAIL || 'admin@saas.local').toLowerCase().trim();
  const senha = process.env.ADMIN_SENHA;
  if (!senha) { console.error('Defina ADMIN_SENHA no .env antes de rodar.'); process.exit(1); }

  const hash = bcrypt.hashSync(senha, 12);
  const { rows } = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
  if (rows[0]) {
    await pool.query('UPDATE usuarios SET senha_hash = $1 WHERE email = $2', [hash, email]);
    await pool.query('DELETE FROM sessoes WHERE usuario_id = $1', [rows[0].id]); // encerra sessões antigas
    console.log(`Senha atualizada para ${email}. Sessões antigas encerradas.`);
  } else {
    console.log(`Usuário ${email} não existe. Crie a organização inicial (bootstrap/signup).`);
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
