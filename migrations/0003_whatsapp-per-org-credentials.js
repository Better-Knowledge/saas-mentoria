/* eslint-disable camelcase */
// Fase 6 (WhatsApp VIP): credenciais do provider POR ORGANIZAÇÃO (bring-your-own).
// Cada org VIP traz a sua Evolution (URL + API key cifrada) e a sua instância; isolamento por org.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE whatsapp_connections
      ADD COLUMN IF NOT EXISTS base_url text,         -- URL do servidor Evolution/Z-API da própria org
      ADD COLUMN IF NOT EXISTS api_key_enc text,      -- credencial do provider da org (AES-256-GCM)
      ADD COLUMN IF NOT EXISTS webhook_token text;    -- segredo por instância p/ verificar o inbound
    CREATE INDEX IF NOT EXISTS idx_wa_conn_instance ON whatsapp_connections (instance_ref);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE whatsapp_connections
      DROP COLUMN IF EXISTS base_url,
      DROP COLUMN IF EXISTS api_key_enc,
      DROP COLUMN IF EXISTS webhook_token;
  `);
};
