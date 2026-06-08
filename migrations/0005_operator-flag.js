/* eslint-disable camelcase */
// Fase 8 (Painel do operador): papel de OPERADOR de plataforma (não confundir com papéis de org).
// O operador faz consultas cross-tenant agregadas (fora do withOrg), restritas e auditadas.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS is_operator boolean NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE usuarios DROP COLUMN IF EXISTS is_operator;`);
};
