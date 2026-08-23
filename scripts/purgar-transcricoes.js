#!/usr/bin/env node
// scripts/purgar-transcricoes.js — descarte da retenção (FR-026a).
//
// A mesma função roda em três momentos: no boot do servidor, a cada 24 h, e aqui à
// mão. Expor o trabalho como script é o que torna a retenção testável sem esperar 90
// dias e sem mexer no relógio da máquina.
require('dotenv').config();
const crm = require('../crm-service');

function purgar() {
  const r = crm.resumoReuniao.purgarExpirados();
  console.log(
    `[retencao] ${r.transcricoes} transcricao(oes) vencida(s) e `
    + `${r.rascunhos} rascunho(s) abandonado(s) descartados.`
  );
  return r;
}

if (require.main === module) purgar();

module.exports = { purgar };
