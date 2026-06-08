// db.js — camada PostgreSQL multi-tenant (substitui o SQLite da v1).
//
// A aplicação conecta com um papel SEM BYPASSRLS; o isolamento entre organizações é imposto no
// BANCO por Row-Level Security (Princípio V). Toda operação de dados de tenant DEVE rodar dentro
// de withOrg(), que aplica `SET LOCAL app.current_org` na transação — sem esse contexto o RLS nega
// (leitura vazia, escrita recusada). O schema vive em migrations/ (node-pg-migrate), não aqui.
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (e) => console.error('Erro inesperado no pool PG:', e.message));

// Executa fn(client) numa transação com o contexto da organização aplicado.
// set_config(..., true) = SET LOCAL: vale só nesta transação (seguro com o pool).
async function withOrg(orgId, fn) {
  if (!orgId) throw new Error('withOrg exige um org_id');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_org', $1, true)", [String(orgId)]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Para signup, login, chaves e webhooks (antes de resolver a org) e o operador: consultas
// explícitas, sem contexto de tenant. NUNCA usar para ler/escrever dados de uma organização.
async function withoutOrg(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// Atalho para uma query única em tabela de plataforma/auth (sem contexto de tenant).
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, withOrg, withoutOrg, query };
