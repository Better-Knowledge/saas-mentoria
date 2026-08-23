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
// Paridade em dois eixos — portão do Princípio V e do PRD RF-64 / RF-80.
//   1. Toda rota registrada no Express existe no openapi.yaml, e vice-versa.
//   2. Toda operação de negócio disponível por REST tem ferramenta MCP equivalente.
// Falha aqui é falha de entrega, não aviso.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const h = require('./helpers/app');

const RAIZ = path.join(__dirname, '..');
let app; let TOOLS;

before(async () => {
  app = await h.app();
  ({ TOOLS } = await import('../mcp/tools.mjs'));
});
after(() => h.limpar());

// Lista de exclusão EXPLÍCITA e versionada (RF-64). Entrada nova aqui exige
// justificativa escrita nesta própria tabela — é o que impede a lista de virar
// um esconderijo para rota não documentada.
const FORA_DO_SPEC = new Map([
  ['/mcp', 'JSON-RPC, não REST — documentado em docs/MCP.md'],
  ['/docs', 'página de documentação, não é API'],
  ['/docs/scalar.js', 'bundle estático do Scalar'],
  ['/openapi.yaml', 'o próprio contrato'],
  ['/api-docs', 'redirect 301 para /docs, mantido para não quebrar links antigos'],
]);

// Converte '/api/clientes/:id' (Express) em '/api/clientes/{id}' (OpenAPI).
const paraOpenApi = (p) => p.replace(/:([A-Za-z_]+)/g, '{$1}');

function rotasDoExpress() {
  const rotas = new Set();
  const percorrer = (pilha, prefixo = '') => {
    for (const camada of pilha) {
      if (camada.route) {
        for (const metodo of Object.keys(camada.route.methods)) {
          rotas.add(`${metodo.toUpperCase()} ${paraOpenApi(prefixo + camada.route.path)}`);
        }
      } else if (camada.name === 'router' && camada.handle && camada.handle.stack) {
        percorrer(camada.handle.stack, prefixo);
      }
    }
  };
  percorrer(app._router.stack);
  return rotas;
}

function rotasDoSpec() {
  const spec = yaml.load(fs.readFileSync(path.join(RAIZ, 'openapi.yaml'), 'utf8'));
  const rotas = new Set();
  for (const [caminho, operacoes] of Object.entries(spec.paths || {})) {
    for (const metodo of Object.keys(operacoes)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(metodo)) {
        rotas.add(`${metodo.toUpperCase()} ${caminho}`);
      }
    }
  }
  return rotas;
}

describe('RF-64 — paridade rota Express ↔ openapi.yaml', () => {
  test('nenhuma rota da API existe sem estar documentada', () => {
    const noSpec = rotasDoSpec();
    const faltando = [...rotasDoExpress()].filter((r) => {
      const caminho = r.split(' ')[1];
      if (FORA_DO_SPEC.has(caminho)) return false;
      if (!caminho.startsWith('/api')) return false;   // estáticos do front
      return !noSpec.has(r);
    });
    assert.deepEqual(faltando, [], 'rotas sem documentação no openapi.yaml');
  });

  test('nenhuma operação documentada existe sem rota que a atenda', () => {
    const noExpress = rotasDoExpress();
    const sobrando = [...rotasDoSpec()].filter((r) => !noExpress.has(r));
    assert.deepEqual(sobrando, [], 'operações no spec sem rota correspondente');
  });

  test('a lista de exclusão traz justificativa para cada entrada', () => {
    for (const [caminho, motivo] of FORA_DO_SPEC) {
      assert.ok(motivo && motivo.length > 10, `${caminho} precisa de justificativa escrita`);
    }
  });
});

describe('RF-64b — paridade campo devolvido ↔ schema do contrato', () => {
  // O teste de rotas acima não pega divergência de CAMPO: uma propriedade nova na
  // resposta atravessa a suíte inteira sem nada reclamar. Foi o que aconteceu com
  // `duracao_ms`, que sobreviveu a duas convergências. Este teste fecha esse eixo.
  const yaml = require('js-yaml');

  function propriedadesDoSchema(nome) {
    const spec = yaml.load(fs.readFileSync(path.join(RAIZ, 'openapi.yaml'), 'utf8'));
    return new Set(Object.keys(spec.components.schemas[nome].properties));
  }

  test('RascunhoResumo declara todo campo que o serviço devolve', () => {
    const src = fs.readFileSync(path.join(RAIZ, 'crm-service.js'), 'utf8');
    const bloco = src.slice(src.indexOf('function serializarRascunho'), src.indexOf('// Monta o texto'));
    const devolvidos = [...bloco.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
    // o payload do rascunho é espalhado no retorno; suas chaves vêm do schema zod
    const doPayload = ['resumo', 'decisoes', 'proximos_passos', 'objecoes', 'sugestao_proxima_acao'];
    const noContrato = propriedadesDoSchema('RascunhoResumo');
    const naoDeclarados = [...devolvidos, ...doPayload].filter((c) => !noContrato.has(c));
    assert.deepEqual(naoDeclarados, [],
      'campo devolvido pela API sem declaração no openapi.yaml');
  });

  test('Interacao declara toda coluna que a API devolve', () => {
    const colunas = h.db.prepare('PRAGMA table_info(interacoes)').all().map((c) => c.name);
    const noContrato = propriedadesDoSchema('Interacao');
    const naoDeclaradas = colunas.filter((c) => !noContrato.has(c));
    assert.deepEqual(naoDeclaradas, [],
      'coluna devolvida em respostas de interação sem declaração no openapi.yaml');
  });
});

describe('RF-80 — paridade serviço REST ↔ ferramenta MCP', () => {
  // Cada operação de negócio exposta por REST e a ferramenta que a espelha.
  const ESPELHO = {
    listarClientes: 'listar_clientes',
    obterCliente: 'obter_cliente',
    criarCliente: 'criar_cliente',
    atualizarCliente: 'atualizar_cliente',
    moverEtapa: 'mover_etapa',
    listarInteracoes: 'listar_interacoes',
    registrarInteracao: 'registrar_interacao',
    exportarCliente: 'exportar_cliente',
    excluirCliente: 'excluir_cliente',
    acoesHoje: 'acoes_hoje',
    dashboard: 'metricas',
    'resumoReuniao.criarRascunho': 'extrair_resumo_reuniao',
    'resumoReuniao.obterRascunho': 'obter_rascunho_resumo',
    'resumoReuniao.confirmarRascunho': 'confirmar_resumo_reuniao',
    'resumoReuniao.descartarRascunho': 'descartar_resumo_reuniao',
    'resumoReuniao.obterTranscricao': 'obter_transcricao',
  };

  test('toda operação de negócio tem ferramenta MCP', () => {
    const nomes = new Set(TOOLS.map((t) => t.name));
    const semFerramenta = Object.entries(ESPELHO)
      .filter(([, ferramenta]) => !nomes.has(ferramenta))
      .map(([servico]) => servico);
    assert.deepEqual(semFerramenta, []);
  });

  test('toda função de serviço espelhada realmente existe', () => {
    const crm = h.crm;
    const inexistentes = Object.keys(ESPELHO).filter((caminho) => {
      const alvo = caminho.split('.').reduce((o, k) => (o ? o[k] : undefined), crm);
      return typeof alvo !== 'function';
    });
    assert.deepEqual(inexistentes, []);
  });

  test('nenhuma ferramenta MCP fica órfã do mapa de paridade', () => {
    const espelhadas = new Set(Object.values(ESPELHO));
    const orfas = TOOLS.map((t) => t.name).filter((n) => !espelhadas.has(n));
    assert.deepEqual(orfas, [], 'ferramenta sem operação REST correspondente');
  });

  test('nenhum inputSchema aceita campo de autoria ou de revisão (FR-019 / RF-73)', () => {
    const proibidos = ['created_by', 'gerado_por_ia', 'autor', 'revisao', 'revisado_por', 'principal'];
    for (const t of TOOLS) {
      for (const campo of Object.keys(t.inputSchema || {})) {
        assert.ok(!proibidos.includes(campo),
          `${t.name} não pode aceitar "${campo}" — autoria vem da credencial`);
      }
    }
  });

  test('confirmar_resumo_reuniao não aceita promoção de próxima ação (FR-028c)', () => {
    const t = TOOLS.find((x) => x.name === 'confirmar_resumo_reuniao');
    assert.ok(!Object.keys(t.inputSchema).includes('promover_proxima_acao'),
      'agente que quer mudar a próxima ação usa atualizar_cliente, numa chamada explícita');
  });

  test('a ferramenta destrutiva avisa a irreversibilidade na descrição (RF-78)', () => {
    const t = TOOLS.find((x) => x.name === 'descartar_resumo_reuniao');
    assert.equal(t.annotations.destructiveHint, true);
    assert.match(t.description, /IRREVERSÍVEL/i);
  });

  test('a ferramenta que alcança serviço externo declara openWorldHint', () => {
    const t = TOOLS.find((x) => x.name === 'extrair_resumo_reuniao');
    assert.equal(t.annotations.openWorldHint, true);
  });
});
