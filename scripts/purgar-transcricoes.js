#!/usr/bin/env node
/*
 * Mini CRM — Consultoria & IA Generativa
 * Copyright (c) 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licenciado sob a licença MIT. O texto completo está em LICENSE, na raiz do projeto.
 * SPDX-License-Identifier: MIT
 */
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
