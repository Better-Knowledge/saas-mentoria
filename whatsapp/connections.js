// whatsapp/connections.js — conexão de WhatsApp POR ORGANIZAÇÃO (uma por org). Guarda a credencial
// do provider da org cifrada (lib/secrets). Sem RLS (lookup global por instância no webhook); o
// segredo fica protegido pela cifragem. Gestão filtra por org_id.
const crypto = require('crypto');
const { pool } = require('../db');
const { encrypt, decrypt } = require('../lib/secrets');

function comCreds(row) {
  if (!row) return null;
  return { ...row, api_key: decrypt(row.api_key_enc) };
}

async function get(orgId) {
  const { rows } = await pool.query('SELECT * FROM whatsapp_connections WHERE org_id = $1', [orgId]);
  return rows[0] || null;
}
async function getCom(orgId) { return comCreds(await get(orgId)); }

// Cria/atualiza a conexão da org (UNIQUE org_id). Gera instance_ref e webhook_token na 1ª vez.
async function upsert(orgId, { provider, base_url, api_key, instance_ref }) {
  const existente = await get(orgId);
  const inst = instance_ref || (existente && existente.instance_ref)
    || ('org-' + String(orgId).replace(/-/g, '').slice(0, 8) + '-' + crypto.randomBytes(3).toString('hex'));
  const token = (existente && existente.webhook_token) || crypto.randomBytes(16).toString('hex');
  const apiEnc = api_key ? encrypt(api_key) : (existente && existente.api_key_enc) || null;
  const { rows } = await pool.query(`
    INSERT INTO whatsapp_connections (org_id, provider, base_url, api_key_enc, instance_ref, webhook_token, estado)
    VALUES ($1,$2,$3,$4,$5,$6,'conectando')
    ON CONFLICT (org_id) DO UPDATE SET
      provider = EXCLUDED.provider, base_url = EXCLUDED.base_url, api_key_enc = EXCLUDED.api_key_enc,
      instance_ref = EXCLUDED.instance_ref, webhook_token = EXCLUDED.webhook_token,
      estado = 'conectando', updated_at = now()
    RETURNING *`, [orgId, provider || 'evolution', base_url, apiEnc, inst, token]);
  return comCreds(rows[0]);
}

async function setEstado(orgId, estado, numero) {
  await pool.query(`
    UPDATE whatsapp_connections SET
      estado = $1,
      numero = COALESCE($2, numero),
      connected_at = CASE WHEN $1 = 'conectado' THEN now() ELSE connected_at END,
      updated_at = now()
    WHERE org_id = $3`, [estado, numero || null, orgId]);
}

async function remove(orgId) { await pool.query('DELETE FROM whatsapp_connections WHERE org_id = $1', [orgId]); }

// Lookup global por instance_ref — usado pelo webhook inbound para identificar a org.
async function porInstancia(instanceRef) {
  const { rows } = await pool.query('SELECT * FROM whatsapp_connections WHERE instance_ref = $1', [instanceRef]);
  return comCreds(rows[0]);
}

// Versão "pública" (sem segredos) para a UI.
function publico(row) {
  if (!row) return null;
  return { provider: row.provider, base_url: row.base_url, instance_ref: row.instance_ref, estado: row.estado, numero: row.numero, connected_at: row.connected_at };
}

module.exports = { get, getCom, upsert, setEstado, remove, porInstancia, publico };
