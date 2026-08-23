#!/usr/bin/env node
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
