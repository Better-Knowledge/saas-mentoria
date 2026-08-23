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
// scripts/medir-extracao.js — mede o SC-005 (≥ 70% dos itens aceitos sem edição).
//
// Roda o extrator REAL sobre o corpus versionado em tests/fixtures/. Fica FORA do
// `npm test` de propósito: chama a API paga. Sem uma medição executável, o SC-005
// seria critério de aceite sem meio de verificação.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const extrator = require('../ia/extrator');

const CORPUS = path.join(__dirname, '..', 'tests', 'fixtures', 'transcricoes-referencia');
const CUSTO_ESTIMADO_POR_EXTRACAO = 0.13; // USD, com claude-opus-5 (ver README)

// Comparação por similaridade de tokens: um item "aceito sem edição" é um item que a
// pessoa não precisaria reescrever. Igualdade exata seria severa demais (pontuação,
// maiúsculas), e substring seria frouxa demais.
function similaridade(a, b) {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
  const A = new Set(norm(a)); const B = new Set(norm(b));
  if (!A.size || !B.size) return 0;
  const comuns = [...A].filter((t) => B.has(t)).length;
  return (2 * comuns) / (A.size + B.size);
}

const LIMIAR_ACEITO = 0.6;

function compararLista(obtidos, esperados) {
  const restantes = [...esperados];
  let aceitos = 0;
  for (const o of obtidos) {
    const i = restantes.findIndex((e) => similaridade(o.texto, e.texto) >= LIMIAR_ACEITO);
    if (i >= 0) { aceitos += 1; restantes.splice(i, 1); }
  }
  return { aceitos, obtidos: obtidos.length, esperados: esperados.length, faltando: restantes };
}

async function medir() {
  if (!extrator.estaConfigurado()) {
    console.error('ANTHROPIC_API_KEY não configurada — nada a medir.');
    process.exit(1);
  }
  const casos = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.txt')).sort();
  if (!casos.length) {
    console.error(`Corpus vazio em ${CORPUS}.`);
    process.exit(1);
  }

  const custo = (casos.length * CUSTO_ESTIMADO_POR_EXTRACAO).toFixed(2);
  console.log(`Vai rodar ${casos.length} extração(ões) reais. Custo estimado: ~US$ ${custo}.`);
  if (!process.argv.includes('--sim')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const resposta = await new Promise((r) => rl.question('Continuar? [s/N] ', r));
    rl.close();
    if (!/^s/i.test(resposta.trim())) { console.log('Cancelado.'); return; }
  }

  const hoje = new Date().toLocaleDateString('en-CA');
  let totalAceitos = 0; let totalObtidos = 0;

  for (const arquivo of casos) {
    const texto = fs.readFileSync(path.join(CORPUS, arquivo), 'utf8');
    const esperado = JSON.parse(
      fs.readFileSync(path.join(CORPUS, arquivo.replace(/\.txt$/, '.esperado.json')), 'utf8')
    );
    console.log(`\n=== ${arquivo} ===`);
    let saida;
    try {
      saida = await extrator.extrair(texto, { hoje });
    } catch (e) {
      console.log(`  FALHOU: ${e.message}`);
      continue;
    }
    for (const tipo of ['decisoes', 'proximos_passos', 'objecoes']) {
      const r = compararLista(saida.rascunho[tipo] || [], esperado[tipo] || []);
      totalAceitos += r.aceitos; totalObtidos += r.obtidos;
      console.log(`  ${tipo}: ${r.aceitos}/${r.obtidos} extraídos batem com o esperado `
        + `(esperava ${r.esperados})`);
      for (const f of r.faltando) console.log(`    NÃO EXTRAÍDO: ${f.texto}`);
    }
    console.log(`  resumo: ${JSON.stringify(saida.rascunho.resumo).slice(0, 120)}…`);
  }

  const taxa = totalObtidos ? (100 * totalAceitos) / totalObtidos : 0;
  console.log(`\n===============================================`);
  console.log(`Taxa de itens aceitos sem edição: ${taxa.toFixed(1)}% (${totalAceitos}/${totalObtidos})`);
  console.log(`Limiar do SC-005: 70%. ${taxa >= 70 ? 'ATINGIDO' : 'ABAIXO — ajuste o prompt (T016), não o limiar.'}`);
  console.log(`Medido em ${hoje}. Registre este número no README.md.`);
}

medir().catch((e) => { console.error(e.message); process.exit(1); });
