/*
 * Mini CRM — Consultoria & IA Generativa
 * Copyright (c) 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licenciado sob a licença MIT. O texto completo está em LICENSE, na raiz do projeto.
 * SPDX-License-Identifier: MIT
 */
// app.js — logica do frontend do Mini CRM

// Etapas do funil (ordem importa)
const ETAPAS = [
  { id: 'novo', nome: 'Novo contato' },
  { id: 'qualificacao', nome: 'Qualificação' },
  { id: 'reuniao', nome: 'Reunião/Diagnóstico' },
  { id: 'proposta', nome: 'Proposta + Fechamento' },
];
const TIPOS = { b2b: 'Empresa (B2B)', autonomo: 'Autônomo', publico: 'Setor público' };

// Sessão do usuário logado. A autenticação é por COOKIE httpOnly (o navegador
// envia sozinho); guardamos só o token CSRF em memória para as escritas.
let USUARIO = null;
let CSRF = null;

// ---- Helpers de rede ----
async function api(metodo, url, corpo) {
  const opts = {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', // envia o cookie de sessão
  };
  if (metodo !== 'GET' && CSRF) opts.headers['X-CSRF-Token'] = CSRF;
  if (corpo) opts.body = JSON.stringify(corpo);
  const resp = await fetch(url, opts);
  if (resp.status === 401) {
    mostrarLogin();
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.erro || 'Erro na requisição');
  }
  return resp.status === 204 ? null : resp.json();
}

function toast(msg, erro = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (erro ? ' erro' : '');
  setTimeout(() => el.classList.add('escondido'), 2600);
}

function fmtMoeda(v) {
  if (!v) return '';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(d) {
  if (!d) return '';
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a}`;
}
function esc(s) {
  return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- Navegacao entre abas ----
document.querySelectorAll('.aba').forEach(aba => {
  aba.addEventListener('click', () => {
    document.querySelectorAll('.aba').forEach(a => a.classList.remove('ativa'));
    document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
    aba.classList.add('ativa');
    const tela = aba.dataset.tela;
    document.getElementById('tela-' + tela).classList.add('ativa');
    if (tela === 'hoje') carregarHoje();
    if (tela === 'dashboard') carregarDashboard();
    if (tela === 'funil') carregarFunil();
    if (tela === 'clientes') carregarClientes();
  });
});

// ---- Modal ----
const modal = document.getElementById('modal');
const modalCorpo = document.getElementById('modal-corpo');
document.getElementById('fecharModal').addEventListener('click', fecharModal);
modal.addEventListener('click', e => { if (e.target === modal) fecharModal(); });
// Acessibilidade do modal (RNF-10, SC-009): guarda quem tinha o foco, move o foco para
// dentro ao abrir e devolve ao fechar. Sem isso, quem navega por teclado continua tabulando
// atrás do modal, sem saber que ele abriu.
let focoAnterior = null;

function abrirModal(html) {
  focoAnterior = document.activeElement;
  modalCorpo.innerHTML = html;
  modal.classList.remove('escondido');
  const primeiro = modalCorpo.querySelector(
    'textarea, input, button, [tabindex]:not([tabindex="-1"])'
  );
  if (primeiro) primeiro.focus({ preventScroll: true });
}

function fecharModal() {
  modal.classList.add('escondido');
  modalCorpo.innerHTML = '';
  if (focoAnterior && document.contains(focoAnterior)) focoAnterior.focus({ preventScroll: true });
  focoAnterior = null;
}

document.getElementById('btnNovo').addEventListener('click', () => abrirFormulario());

// =================== TELA HOJE ===================
async function carregarHoje() {
  const dados = await api('GET', '/api/hoje');
  // cards de resumo
  const resumo = document.getElementById('resumo-hoje');
  const totalAtivos = dados.atrasados.length + dados.hoje.length + dados.futuros.length;
  resumo.innerHTML = `
    <div class="stat-card ${dados.atrasados.length ? 'alerta' : ''}">
      <div class="stat-num">${dados.atrasados.length}</div>
      <div class="stat-lbl">Atrasados</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${dados.hoje.length}</div>
      <div class="stat-lbl">Para hoje</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${dados.futuros.length}</div>
      <div class="stat-lbl">Próximos</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${totalAtivos}</div>
      <div class="stat-lbl">Em acompanhamento</div>
    </div>`;
  renderListaHoje('lista-atrasados', dados.atrasados, 'Nada atrasado — tudo em dia.');
  renderListaHoje('lista-hoje', dados.hoje, 'Nada agendado para hoje.');
  renderListaHoje('lista-futuros', dados.futuros, 'Sem ações futuras agendadas.');
}
function renderListaHoje(elId, itens, vazioMsg) {
  const el = document.getElementById(elId);
  if (!itens.length) { el.innerHTML = `<div class="vazio">${vazioMsg}</div>`; return; }
  el.innerHTML = itens.map(c => `
    <div class="item" data-acao="ficha" data-id="${c.id}" role="button" tabindex="0" aria-label="Abrir ficha de ${esc(c.nome)}">
      <div class="info">
        <b>${esc(c.nome)}</b>
        <small>${esc(c.empresa || '')} ${c.valor_estimado ? '· ' + fmtMoeda(c.valor_estimado) : ''}</small>
      </div>
      <div class="acao">${esc(c.proxima_acao || 'Follow-up')}<br><span class="quando">${fmtData(c.proxima_acao_data)}</span></div>
    </div>
  `).join('');
}

// =================== TELA FUNIL (KANBAN) ===================
async function carregarFunil() {
  const clientes = await api('GET', '/api/clientes');
  const kanban = document.getElementById('kanban');
  kanban.innerHTML = ETAPAS.map(et => {
    const doGrupo = clientes.filter(c => c.etapa === et.id);
    const cartoes = doGrupo.map(c => cartaoHTML(c)).join('') || '<div class="vazio">—</div>';
    return `
      <div class="coluna" data-etapa="${et.id}">
        <div class="coluna-titulo">${et.nome} <span class="cont">${doGrupo.length}</span></div>
        ${cartoes}
      </div>`;
  }).join('');
}
function cartaoHTML(c) {
  let tag = '';
  if (c.resultado === 'ganho') tag = '<span class="tag ganho">Ganho</span>';
  if (c.resultado === 'perdido') tag = '<span class="tag perdido">Perdido</span>';
  return `
    <div class="cartao" draggable="true" data-id="${c.id}" data-acao="ficha" role="button" tabindex="0" aria-label="Abrir ficha de ${esc(c.nome)}">
      <b>${esc(c.nome)}</b>
      <small>${esc(c.empresa || '')}</small>
      ${c.valor_estimado ? `<div class="valor">${fmtMoeda(c.valor_estimado)}</div>` : ''}
      ${tag}
    </div>`;
}
// drag & drop — delegado no container do kanban. As funções recebem a coluna
// explicitamente porque, com delegação, `currentTarget` é o container, não o alvo.
let arrastandoId = null;
function iniciarArraste(cartao) { arrastandoId = cartao.dataset.id; cartao.classList.add('arrastando'); }
function fimArraste(cartao) { cartao.classList.remove('arrastando'); }
async function soltarCartao(coluna) {
  coluna.classList.remove('dragover');
  const novaEtapa = coluna.dataset.etapa;
  if (!arrastandoId) return;
  try {
    await api('PUT', `/api/clientes/${arrastandoId}/etapa`, { etapa: novaEtapa });
    toast('Cliente movido!');
    carregarFunil();
  } catch (err) { toast(err.message, true); }
  arrastandoId = null;
}

// =================== TELA CLIENTES ===================
let cacheClientes = [];
async function carregarClientes() {
  cacheClientes = await api('GET', '/api/clientes');
  renderClientes(cacheClientes);
}
document.getElementById('busca').addEventListener('input', e => {
  const t = e.target.value.toLowerCase();
  renderClientes(cacheClientes.filter(c =>
    (c.nome || '').toLowerCase().includes(t) || (c.empresa || '').toLowerCase().includes(t)));
});
function renderClientes(lista) {
  const el = document.getElementById('tabela-clientes');
  if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhum cliente. Clique em "+ Novo cliente".</div>'; return; }
  el.innerHTML = lista.map(c => {
    const etapa = ETAPAS.find(e => e.id === c.etapa);
    return `
    <div class="item" data-acao="ficha" data-id="${c.id}" role="button" tabindex="0" aria-label="Abrir ficha de ${esc(c.nome)}">
      <div class="info">
        <b>${esc(c.nome)}</b>
        <small>${esc(c.empresa || '')} · ${etapa ? etapa.nome : c.etapa} · ${c.total_interacoes} interações</small>
      </div>
      <div class="acao">${c.valor_estimado ? fmtMoeda(c.valor_estimado) : ''}</div>
    </div>`;
  }).join('');
}

// =================== FICHA DO CLIENTE ===================
async function abrirFicha(id) {
  const c = await api('GET', '/api/clientes/' + id);
  const etapa = ETAPAS.find(e => e.id === c.etapa);
  const interacoes = (c.interacoes || []).map(i => `
    <div class="interacao">
      ${esc(i.texto)}
      <div class="meta">
        ${esc(i.data)}${i.gerado_por_ia ? '<span class="badge-ia">IA</span>' : ''}${selosRevisao(i)}
        ${i.origem_registro === 'resumo_reuniao'
          ? `<button type="button" class="btn pequeno" data-acao="ver-transcricao" data-interacao="${i.id}" aria-label="Ver a transcrição de origem deste registro">ver transcrição</button>`
          : ''}
      </div>
    </div>`).join('') || '<div class="vazio">Sem interações ainda.</div>';

  abrirModal(`
    <h1>${esc(c.nome)}</h1>
    <p class="subtitulo">${esc(c.empresa || '')} ${c.cargo ? '· ' + esc(c.cargo) : ''}</p>

    <div class="ficha-secao">
      <h3>Contato e origem</h3>
      <div class="dado"><span>Telefone:</span> ${esc(c.telefone || '—')}</div>
      <div class="dado"><span>E-mail:</span> ${esc(c.email || '—')}</div>
      <div class="dado"><span>Tipo:</span> ${TIPOS[c.tipo_cliente] || c.tipo_cliente}</div>
      <div class="dado"><span>Origem:</span> ${esc(c.origem || '—')}</div>
      <div class="dado"><span>Etapa:</span> ${etapa ? etapa.nome : c.etapa}</div>
    </div>

    <div class="ficha-secao">
      <h3>Negócio</h3>
      <div class="dado"><span>Valor estimado:</span> ${fmtMoeda(c.valor_estimado) || '—'}</div>
      <div class="dado"><span>Proposta enviada:</span> ${c.proposta_enviada ? 'Sim' : 'Não'}</div>
      <div class="dado"><span>Status pagamento:</span> ${esc(c.status_pagamento || '—')}</div>
      <div class="dado"><span>Resultado:</span> ${c.resultado}</div>
    </div>

    <div class="ficha-secao">
      <h3>Próxima ação (anti-esquecimento)</h3>
      <div class="dado"><span>${esc(c.proxima_acao || 'Nenhuma definida')}</span> ${c.proxima_acao_data ? '— ' + fmtData(c.proxima_acao_data) : ''}</div>
    </div>

    <div class="ficha-secao">
      <h3>Histórico de interações</h3>
      <div class="campo">
        <textarea id="novaInteracao" placeholder="Anote uma conversa, reunião ou observação..."></textarea>
      </div>
      <button type="button" class="btn primario" data-acao="salvar-interacao" data-id="${c.id}">+ Adicionar anotação</button>
      <button type="button" class="btn" data-acao="abrir-resumo" data-cliente="${c.id}">Resumir reunião</button>
      <div style="margin-top:14px">${interacoes}</div>
    </div>

    <div class="acoes-modal">
      <button type="button" class="btn primario" data-acao="editar-cliente" data-id="${c.id}">Editar</button>
      <button type="button" class="btn" data-acao="exportar-cliente" data-id="${c.id}">Exportar dados (LGPD)</button>
      <button type="button" class="btn perigo" data-acao="excluir-cliente" data-id="${c.id}">Excluir (LGPD)</button>
    </div>
  `);
}

async function salvarInteracao(id) {
  const texto = document.getElementById('novaInteracao').value.trim();
  if (!texto) return toast('Escreva algo antes de salvar.', true);
  try {
    await api('POST', `/api/clientes/${id}/interacoes`, { texto });
    toast('Anotação salva!');
    abrirFicha(id);
  } catch (err) { toast(err.message, true); }
}

function exportarCliente(id) {
  window.open(`/api/clientes/${id}/export`, '_blank');
}

async function excluirCliente(id) {
  if (!confirm('Excluir este cliente e TODO o histórico? Esta ação não pode ser desfeita.')) return;
  try {
    await api('DELETE', '/api/clientes/' + id);
    toast('Cliente excluído.');
    fecharModal();
    recarregarTelaAtiva();
  } catch (err) { toast(err.message, true); }
}

// =================== FORMULARIO (novo/editar) ===================
async function abrirFormulario(id) {
  let c = { tipo_cliente: 'b2b', etapa: 'novo', resultado: 'em_aberto', proposta_enviada: 0 };
  if (id) c = await api('GET', '/api/clientes/' + id);
  const op = (val, atual, label) => `<option value="${val}" ${val === atual ? 'selected' : ''}>${label}</option>`;

  abrirModal(`
    <h1>${id ? 'Editar' : 'Novo'} cliente</h1>
    <div class="linha">
      <div class="campo"><label>Nome *</label><input id="f_nome" value="${esc(c.nome || '')}" /></div>
      <div class="campo"><label>Empresa</label><input id="f_empresa" value="${esc(c.empresa || '')}" /></div>
    </div>
    <div class="linha">
      <div class="campo"><label>Cargo</label><input id="f_cargo" value="${esc(c.cargo || '')}" /></div>
      <div class="campo"><label>Telefone/WhatsApp</label><input id="f_telefone" value="${esc(c.telefone || '')}" /></div>
    </div>
    <div class="linha">
      <div class="campo"><label>E-mail</label><input id="f_email" value="${esc(c.email || '')}" /></div>
      <div class="campo"><label>Origem do lead</label><input id="f_origem" value="${esc(c.origem || '')}" placeholder="Indicação, Instagram, LinkedIn..." /></div>
    </div>
    <div class="linha">
      <div class="campo"><label>Tipo de cliente</label><select id="f_tipo">
        ${op('b2b', c.tipo_cliente, 'Empresa (B2B)')}${op('autonomo', c.tipo_cliente, 'Autônomo')}${op('publico', c.tipo_cliente, 'Setor público')}
      </select></div>
      <div class="campo"><label>Etapa do funil</label><select id="f_etapa">
        ${ETAPAS.map(e => op(e.id, c.etapa, e.nome)).join('')}
      </select></div>
    </div>
    <div class="linha">
      <div class="campo"><label>Valor estimado (R$)</label><input id="f_valor" type="number" value="${c.valor_estimado || ''}" /></div>
      <div class="campo"><label>Resultado</label><select id="f_resultado">
        ${op('em_aberto', c.resultado, 'Em aberto')}${op('ganho', c.resultado, 'Ganho')}${op('perdido', c.resultado, 'Perdido')}
      </select></div>
    </div>
    <div class="linha">
      <div class="campo"><label>Proposta enviada?</label><select id="f_proposta">
        ${op('0', String(c.proposta_enviada), 'Não')}${op('1', String(c.proposta_enviada), 'Sim')}
      </select></div>
      <div class="campo"><label>Status do pagamento</label><input id="f_pagamento" value="${esc(c.status_pagamento || '')}" placeholder="Aguardando, pago..." /></div>
    </div>
    <div class="linha">
      <div class="campo"><label>Próxima ação</label><input id="f_acao" value="${esc(c.proxima_acao || '')}" placeholder="Ligar, enviar proposta..." /></div>
      <div class="campo"><label>Data da próxima ação</label><input id="f_acao_data" type="date" value="${c.proxima_acao_data || ''}" /></div>
    </div>
    <div class="acoes-modal">
      <button type="button" class="btn primario" data-acao="salvar-cliente" data-id="${id || ''}">Salvar</button>
      <button type="button" class="btn" data-acao="${id ? 'ficha' : 'fechar-modal'}" data-id="${id || ''}">Cancelar</button>
    </div>
  `);
}

async function salvarCliente(id) {
  const dados = {
    nome: val('f_nome'), empresa: val('f_empresa'), cargo: val('f_cargo'),
    telefone: val('f_telefone'), email: val('f_email'), origem: val('f_origem'),
    tipo_cliente: val('f_tipo'), etapa: val('f_etapa'),
    valor_estimado: val('f_valor'), resultado: val('f_resultado'),
    proposta_enviada: val('f_proposta') === '1', status_pagamento: val('f_pagamento'),
    proxima_acao: val('f_acao'), proxima_acao_data: val('f_acao_data'),
  };
  if (!dados.nome) return toast('O nome é obrigatório.', true);
  try {
    if (id) await api('PUT', '/api/clientes/' + id, dados);
    else await api('POST', '/api/clientes', dados);
    toast('Cliente salvo!');
    fecharModal();
    recarregarTelaAtiva();
  } catch (err) { toast(err.message, true); }
}
function val(id) { return document.getElementById(id).value.trim(); }

function recarregarTelaAtiva() {
  const ativa = document.querySelector('.aba.ativa').dataset.tela;
  if (ativa === 'hoje') carregarHoje();
  if (ativa === 'dashboard') carregarDashboard();
  if (ativa === 'funil') carregarFunil();
  if (ativa === 'clientes') carregarClientes();
}

// =================== DASHBOARD ===================
// Gráficos em SVG gerado aqui mesmo: sem biblioteca, sem peso extra e sem
// afrouxar a CSP. As cores saem das variáveis do design system.
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function rotuloMes(chave) {              // '2026-08' -> 'ago/26'
  const [a, m] = chave.split('-');
  return `${MESES_CURTOS[Number(m) - 1]}/${a.slice(2)}`;
}
function fmtCompacto(v) {                // 239500 -> 'R$ 240k'
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return 'R$ ' + Math.round(n / 1000) + 'k';
  return 'R$ ' + Math.round(n);
}

// Barras agrupadas: duas séries lado a lado ao longo dos meses.
function svgBarrasAgrupadas(serie, series) {
  const L = 52, R = 8, T = 10, B = 26, W = 720, H = 220;
  const larguraPlot = W - L - R, alturaPlot = H - T - B;
  const max = Math.max(1, ...serie.flatMap(p => series.map(s => p[s.campo])));
  const slot = larguraPlot / serie.length;
  const larguraBarra = Math.min(16, (slot - 8) / series.length);
  const y = v => T + alturaPlot - (v / max) * alturaPlot;

  // 4 linhas de grade + rótulos do eixo
  const grade = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const vy = T + alturaPlot - f * alturaPlot;
    return `<line class="svg-grade" x1="${L}" y1="${vy}" x2="${W - R}" y2="${vy}" />
      <text class="svg-rotulo" x="${L - 8}" y="${vy + 4}" text-anchor="end">${series[0].moeda ? fmtCompacto(max * f) : Math.round(max * f)}</text>`;
  }).join('');

  const barras = serie.map((p, i) => {
    const base = L + i * slot + (slot - larguraBarra * series.length) / 2;
    return series.map((s, j) => {
      const v = p[s.campo];
      const altura = Math.max(v > 0 ? 2 : 0, T + alturaPlot - y(v));
      return `<rect x="${base + j * larguraBarra}" y="${y(v)}" width="${larguraBarra - 2}" height="${altura}"
        rx="2" fill="${s.cor}"><title>${rotuloMes(p.mes)} — ${s.nome}: ${s.moeda ? fmtMoeda(v) || 'R$ 0' : v}</title></rect>`;
    }).join('');
  }).join('');

  const rotulos = serie.map((p, i) =>
    `<text class="svg-rotulo" x="${L + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle">${rotuloMes(p.mes)}</text>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img">${grade}${barras}${rotulos}</svg>`;
}

// Linha com área: acumulado ao longo dos meses.
function svgLinha(serie, campo, cor) {
  const L = 52, R = 8, T = 10, B = 26, W = 720, H = 220;
  const larguraPlot = W - L - R, alturaPlot = H - T - B;
  let acumulado = 0;
  const pontos = serie.map((p, i) => {
    acumulado += p[campo];
    return { x: L + (larguraPlot / Math.max(1, serie.length - 1)) * i, v: acumulado, mes: p.mes };
  });
  const max = Math.max(1, ...pontos.map(p => p.v));
  const y = v => T + alturaPlot - (v / max) * alturaPlot;

  const grade = [0, 0.5, 1].map(f => {
    const vy = T + alturaPlot - f * alturaPlot;
    return `<line class="svg-grade" x1="${L}" y1="${vy}" x2="${W - R}" y2="${vy}" />
      <text class="svg-rotulo" x="${L - 8}" y="${vy + 4}" text-anchor="end">${fmtCompacto(max * f)}</text>`;
  }).join('');

  const d = pontos.map((p, i) => `${i ? 'L' : 'M'}${p.x},${y(p.v)}`).join(' ');
  const area = `${d} L${pontos[pontos.length - 1].x},${T + alturaPlot} L${pontos[0].x},${T + alturaPlot} Z`;
  const bolinhas = pontos.map(p =>
    `<circle cx="${p.x}" cy="${y(p.v)}" r="3.5" fill="${cor}"><title>${rotuloMes(p.mes)}: ${fmtMoeda(p.v) || 'R$ 0'}</title></circle>`
  ).join('');
  const rotulos = pontos.map((p, i) =>
    i % 2 === 0 ? `<text class="svg-rotulo" x="${p.x}" y="${H - 8}" text-anchor="middle">${rotuloMes(p.mes)}</text>` : ''
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img">${grade}
    <path d="${area}" fill="${cor}" opacity="0.12" />
    <path d="${d}" fill="none" stroke="${cor}" stroke-width="2.5" stroke-linejoin="round" />
    ${bolinhas}${rotulos}</svg>`;
}

// Barras horizontais em HTML (mais legíveis que SVG para rótulos longos).
function barrasHorizontais(itens) {
  const max = Math.max(1, ...itens.map(i => i.valor));
  return itens.map(i => `
    <div class="barra-linha">
      <div class="barra-nome">${esc(i.nome)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>
      <div class="barra-trilho">
        <div class="barra-preenchida" style="width:${(i.valor / max) * 100}%; background:${i.cor}"></div>
      </div>
      <div class="barra-valor">${i.rotulo}</div>
    </div>`).join('');
}

function caixaGrafico(titulo, nota, conteudo, legenda) {
  return `<div class="grafico-caixa">
    <div class="grafico-titulo">${titulo}</div>
    ${nota ? `<div class="grafico-nota">${nota}</div>` : ''}
    ${conteudo}
    ${legenda ? `<div class="legenda">${legenda}</div>` : ''}
  </div>`;
}

function listaAtencao(titulo, nota, itens, vazio) {
  const linhas = itens.length ? itens.map(c => `
    <div class="item" data-acao="ficha" data-id="${c.id}" role="button" tabindex="0" aria-label="Abrir ficha de ${esc(c.nome)}">
      <div class="info">
        <b>${esc(c.nome)}</b>
        <small>${esc(c.empresa || '—')}${c.dias != null ? ` · parado há ${c.dias} dias` : ''}</small>
      </div>
      <div class="acao">${fmtMoeda(c.valor_estimado) || '—'}</div>
    </div>`).join('') : `<div class="vazio">${vazio}</div>`;
  return `<div class="grafico-caixa">
    <div class="grafico-titulo">${titulo} ${itens.length ? `<span class="tag perdido">${itens.length}</span>` : ''}</div>
    <div class="grafico-nota">${nota}</div>
    <div class="lista" style="margin-top:14px">${linhas}</div>
  </div>`;
}

async function carregarDashboard() {
  const d = await api('GET', '/api/dashboard');
  const k = d.kpis;
  const CORES = { ganho: 'var(--success)', perda: 'var(--danger)', destaque: 'var(--ac-orange)', neutro: 'var(--ac-stone)' };

  // ---- aviso quando ainda não há história suficiente para as séries ----
  const mesesComFecho = d.serie.filter(m => m.ganhos || m.perdidos).length;
  document.getElementById('dash-aviso').innerHTML = mesesComFecho <= 1
    ? `<div class="dash-aviso"><b>Base de histórico ainda curta.</b> Os gráficos mensais só ficam
       interessantes depois de alguns meses de negócios fechados. Negócios que já estavam fechados
       antes desta tela existir receberam a data da última alteração como estimativa.</div>`
    : '';

  // ---- camada 1: KPIs ----
  document.getElementById('dash-kpis').innerHTML = `
    <div class="stat-card">
      <div class="stat-num medio">${fmtMoeda(k.pipeline.valor) || 'R$ 0'}</div>
      <div class="stat-lbl">Pipeline em aberto</div>
      <div class="stat-ctx"><span class="destaque">${k.pipeline.qtd}</span> negócios em andamento</div>
    </div>
    <div class="stat-card">
      <div class="stat-num medio">${fmtMoeda(k.ponderado.valor) || 'R$ 0'}</div>
      <div class="stat-lbl">Pipeline ponderado</div>
      <div class="stat-ctx">previsão pelo peso de cada etapa</div>
    </div>
    <div class="stat-card ${k.vitoria.pct != null && k.vitoria.pct < 50 ? 'alerta' : ''}">
      <div class="stat-num medio">${k.vitoria.pct == null ? '—' : Math.round(k.vitoria.pct) + '%'}</div>
      <div class="stat-lbl">Taxa de vitória</div>
      <div class="stat-ctx">${k.vitoria.ganhos} ganhos · ${k.vitoria.perdidos} perdidos</div>
    </div>
    <div class="stat-card">
      <div class="stat-num medio">${k.ticketMedio.valor == null ? '—' : fmtMoeda(k.ticketMedio.valor)}</div>
      <div class="stat-lbl">Ticket médio</div>
      <div class="stat-ctx">${k.ticketMedio.base ? `base de ${k.ticketMedio.base} negócio(s) ganho(s)` : 'sem negócios ganhos ainda'}
        ${k.cicloDias != null ? ` · ciclo de ${k.cicloDias} dias` : ''}</div>
    </div>`;

  // ---- camada 2: evolução ----
  document.getElementById('dash-evolucao').innerHTML =
    caixaGrafico('Ganhos × perdidos por mês', 'Valor dos negócios fechados em cada mês.',
      svgBarrasAgrupadas(d.serie, [
        { campo: 'valorGanho', nome: 'Ganhos', cor: CORES.ganho, moeda: true },
        { campo: 'valorPerdido', nome: 'Perdidos', cor: CORES.perda, moeda: true },
      ]),
      `<span><i style="background:var(--success)"></i>Ganhos</span>
       <span><i style="background:var(--danger)"></i>Perdidos</span>`)
    + caixaGrafico('Receita ganha acumulada', 'Soma corrida dos negócios ganhos no período.',
      svgLinha(d.serie, 'valorGanho', 'var(--ac-orange)'))
    + caixaGrafico('Novos leads por mês', 'Quantos entraram no funil — mede geração de demanda.',
      svgBarrasAgrupadas(d.serie, [{ campo: 'novos', nome: 'Novos leads', cor: CORES.destaque }]))
    + caixaGrafico('Quem cadastra os leads', 'Adoção do agente de IA frente ao cadastro manual.',
      barrasHorizontais([
        { nome: 'Humano', valor: d.autoria.humano, rotulo: d.autoria.humano, cor: 'var(--ac-graphite)' },
        { nome: 'IA', valor: d.autoria.ia, rotulo: d.autoria.ia, cor: CORES.destaque },
      ]));

  // ---- camada 3: composição ----
  const nomeEtapa = id => (ETAPAS.find(e => e.id === id) || {}).nome || id;
  document.getElementById('dash-composicao').innerHTML =
    caixaGrafico('Funil em aberto', 'Valor parado em cada etapa. Pipeline empilhado no começo é ilusão de volume.',
      barrasHorizontais(d.funil.map(f => ({
        nome: nomeEtapa(f.etapa), sub: `${f.qtd} negócio(s) · peso ${Math.round(f.peso * 100)}%`,
        valor: f.valor, rotulo: fmtCompacto(f.valor), cor: CORES.destaque,
      }))))
    + caixaGrafico('Origem dos leads', 'A barra é o valor <b>ganho</b>, não o volume: origem que traz muito e fecha pouco não merece barra. O pipeline em aberto aparece no texto.',
      barrasHorizontais(d.origens.map(o => ({
        nome: o.origem,
        // quem já fechou mostra os ganhos; quem não fechou mostra o que ainda
        // está em jogo — uma informação por linha, sem estourar a coluna
        sub: o.ganhos
          ? `${o.qtd} lead(s) · ${o.ganhos} ganho(s)`
          : `${o.qtd} lead(s) · ${fmtCompacto(o.valorAberto)} aberto`,
        valor: o.valorGanho,
        rotulo: o.valorGanho ? fmtCompacto(o.valorGanho) : '—',
        cor: CORES.ganho,
      }))))
    + caixaGrafico('Por tipo de cliente', 'Distribuição da carteira.',
      barrasHorizontais(d.tipos.map(t => ({
        nome: TIPOS[t.tipo] || t.tipo, sub: fmtMoeda(t.valor) || 'R$ 0',
        valor: t.qtd, rotulo: t.qtd, cor: 'var(--ac-graphite)',
      }))));

  // ---- camada 4: listas de ação ----
  document.getElementById('dash-atencao').innerHTML =
    listaAtencao('Sem próxima ação agendada',
      'Estes somem da tela Hoje — é o vazamento silencioso do funil.',
      d.atencao.semProximaAcao, 'Nenhum lead solto. Funil limpo.')
    + listaAtencao(`Parados há mais de ${d.atencao.diasParado} dias`,
      'Sem qualquer movimentação no cadastro ou anotação.',
      d.atencao.parados, 'Nada esquecido por aqui.')
    + listaAtencao('Propostas enviadas em aberto',
      'Onde está o dinheiro mais quente — vale um follow-up.',
      d.atencao.propostasAbertas, 'Nenhuma proposta aguardando resposta.');
}

// =================== LOGIN / SESSÃO ===================
// ===================== RESUMO DE REUNIÃO (feature 002) =====================
// Eventos por DELEGAÇÃO: um listener na raiz do modal, alvo identificado por data-*.
// Nenhum onclick em atributo — é o que permite à CSP dispensar 'unsafe-inline'
// (RNF-16). O código anterior desta tela usa onclick; a remoção daqueles é RNF-16 da
// fundação v2, não desta feature.

let RASCUNHO = null;              // rascunho em revisão, só na memória desta aba
let clienteDoResumo = null;
let extracaoEmCurso = null;       // AbortController da chamada em andamento

const RETENCAO_DIAS = 90;

// Selos exibidos no histórico. Distinguir "revisado por gente" de "nenhuma pessoa
// olhou isto" é o ponto inteiro do FR-028a — sem o selo, os dois somem no mesmo badge.
function selosRevisao(i) {
  if (i.revisao === 'humana') {
    const quem = i.revisado_em ? ` em ${esc(fmtData(String(i.revisado_em).slice(0, 10)))}` : '';
    return `<span class="chip-revisao">revisado${quem}</span>`;
  }
  if (i.revisao === 'sem_revisao') {
    return '<span class="chip-atencao" title="Confirmado por automação, sem conferência humana">não revisado</span>';
  }
  return '';
}

function abrirColarTranscricao(clienteId) {
  clienteDoResumo = clienteId;
  RASCUNHO = null;
  abrirModal(`
    <h1>Resumir reunião</h1>
    <p class="subtitulo">Cole a transcrição. Nada é salvo antes de você revisar e confirmar.</p>
    <div class="campo">
      <label for="transcricao">Transcrição da reunião</label>
      <textarea id="transcricao" rows="12" placeholder="Cole aqui o texto da reunião..."></textarea>
    </div>
    <p class="aviso-retencao">
      A transcrição fica guardada por ${RETENCAO_DIAS} dias para você poder conferir a fonte,
      e depois é descartada automaticamente. Telefones, e-mails e documentos são mascarados
      antes do envio ao serviço de IA.
    </p>
    <div class="acoes-modal">
      <button type="button" class="btn primario" data-acao="extrair">Extrair</button>
      <button type="button" class="btn" data-acao="fechar-resumo">Cancelar</button>
    </div>
  `);
}

async function extrairResumo() {
  const campo = document.getElementById('transcricao');
  const texto = (campo ? campo.value : '').trim();
  if (!texto) return toast('Cole a transcrição antes de extrair.', true);

  const botao = document.querySelector('[data-acao="extrair"]');
  if (botao) { botao.disabled = true; botao.textContent = 'Extraindo…'; }

  // Teto de 60 s no cliente também: a espera tem que terminar de algum jeito, com
  // mensagem, em vez de deixar a pessoa olhando um botão travado (FR-031).
  extracaoEmCurso = new AbortController();
  const prazo = setTimeout(() => extracaoEmCurso.abort(), 60000);
  try {
    const r = await fetch(`/api/clientes/${clienteDoResumo}/resumos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify({ transcricao: texto }),
      signal: extracaoEmCurso.signal,
    });
    const dados = await r.json().catch(() => ({}));
    // Este caminho usa fetch cru por causa do AbortController, então precisa repetir o
    // tratamento de 401 que o helper api() já faz. Sem ele, uma sessão que expira aqui
    // devolveria um toast genérico e deixaria a transcrição na tela (FR-094, FR-025).
    if (r.status === 401) { mostrarLogin(); throw new Error('Sessão expirada. Faça login novamente.'); }
    if (!r.ok) throw new Error(dados.erro || 'Não foi possível extrair.');
    RASCUNHO = dados;
    renderRevisao();
  } catch (err) {
    // A transcrição NÃO se perde: a tela de colar continua com o texto (FR-006).
    if (err.name === 'AbortError') {
      toast('A extração passou de 60 segundos e foi cancelada. Nada foi gravado.', true);
    } else {
      toast(err.message, true);
    }
    if (botao) { botao.disabled = false; botao.textContent = 'Extrair'; }
  } finally {
    clearTimeout(prazo);
    extracaoEmCurso = null;
  }
}

function listaEditavel(tipo, itens, vazio, comDetalhes = false) {
  if (!itens.length) return `<div class="vazio">${esc(vazio)}</div>`;
  return itens.map((item, i) => `
    <div class="item item-revisao">
      <div class="campo">
        <textarea data-campo="texto" data-tipo="${tipo}" data-i="${i}" rows="2" aria-label="Texto do item">${esc(item.texto)}</textarea>
      </div>
      ${comDetalhes ? `
        <div class="linha-detalhes">
          <input type="text" data-campo="responsavel" data-tipo="${tipo}" data-i="${i}"
                 placeholder="Responsável (não declarado)" aria-label="Responsável pelo passo" value="${esc(item.responsavel || '')}" />
          <input type="date" data-campo="prazo" data-tipo="${tipo}" data-i="${i}"
                 aria-label="Prazo do passo" value="${esc(item.prazo || '')}" />
          <button type="button" class="btn pequeno" data-acao="promover" data-i="${i}" aria-label="Transformar este passo na próxima ação do cliente">Virar próxima ação</button>
        </div>` : ''}
      <button type="button" class="btn pequeno perigo" data-acao="remover" data-tipo="${tipo}" data-i="${i}" aria-label="Remover este item">Remover</button>
    </div>`).join('');
}

function renderRevisao() {
  const r = RASCUNHO;
  const promovido = r.promover_proxima_acao;
  abrirModal(`
    <h1>Revisar antes de salvar</h1>
    <p class="subtitulo aviso-ia">
      Gerado por IA a partir da transcrição — <strong>ainda não foi salvo</strong>.
      Corrija o que estiver errado antes de confirmar.
    </p>

    <div class="ficha-secao">
      <h3>Resumo</h3>
      <div class="campo">
        <textarea id="resumo-texto" rows="4" aria-label="Resumo da reunião">${esc(r.resumo || '')}</textarea>
      </div>
    </div>

    <div class="ficha-secao">
      <h3>Decisões <button type="button" class="btn pequeno" data-acao="add" data-tipo="decisoes" aria-label="Acrescentar decisão">+ item</button></h3>
      ${listaEditavel('decisoes', r.decisoes || [], 'Nenhuma decisão identificada nesta reunião.')}
    </div>

    <div class="ficha-secao">
      <h3>Próximos passos <button type="button" class="btn pequeno" data-acao="add" data-tipo="proximos_passos" aria-label="Acrescentar próximo passo">+ item</button></h3>
      ${listaEditavel('proximos_passos', r.proximos_passos || [], 'Nenhum próximo passo identificado.', true)}
    </div>

    <div class="ficha-secao">
      <h3>Objeções <button type="button" class="btn pequeno" data-acao="add" data-tipo="objecoes" aria-label="Acrescentar objeção">+ item</button></h3>
      ${listaEditavel('objecoes', r.objecoes || [], 'Nenhuma objeção identificada.')}
    </div>

    ${promovido ? `
      <div class="ficha-secao destaque-promocao">
        <h3>Próxima ação a aplicar</h3>
        <div class="dado"><span>${esc(promovido.texto)}</span> — ${esc(promovido.data || 'sem data')}</div>
        <button type="button" class="btn pequeno" data-acao="cancelar-promocao" aria-label="Não aplicar a próxima ação sugerida">Não aplicar</button>
      </div>` : ''}

    <div class="acoes-modal">
      <button type="button" class="btn primario" data-acao="confirmar">Confirmar e salvar</button>
      <button type="button" class="btn perigo" data-acao="descartar">Descartar</button>
    </div>
  `);
}

// Lê de volta o que foi editado na tela para dentro do rascunho em memória.
function coletarEdicoes() {
  const resumoTexto = document.getElementById('resumo-texto');
  if (resumoTexto) RASCUNHO.resumo = resumoTexto.value;
  document.querySelectorAll('[data-campo][data-tipo][data-i]').forEach((el) => {
    const lista = RASCUNHO[el.dataset.tipo];
    if (!lista || !lista[el.dataset.i]) return;
    const valor = el.value.trim();
    lista[el.dataset.i][el.dataset.campo] = valor === '' ? (el.dataset.campo === 'texto' ? '' : null) : valor;
  });
}

async function confirmarResumo({ substituir = false } = {}) {
  coletarEdicoes();
  const corpo = {
    resumo: RASCUNHO.resumo || '',
    decisoes: (RASCUNHO.decisoes || []).filter((i) => i.texto.trim()),
    proximos_passos: (RASCUNHO.proximos_passos || []).filter((i) => i.texto.trim()),
    objecoes: (RASCUNHO.objecoes || []).filter((i) => i.texto.trim()),
  };
  if (RASCUNHO.promover_proxima_acao) {
    corpo.promover_proxima_acao = { ...RASCUNHO.promover_proxima_acao, substituir };
  }
  try {
    const r = await fetch(`/api/resumos/${RASCUNHO.id}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify(corpo),
    });
    const dados = await r.json().catch(() => ({}));
    // Mesma razão: fetch cru aqui por causa do 409, logo o 401 precisa ser tratado à mão.
    if (r.status === 401) { mostrarLogin(); throw new Error('Sessão expirada. Faça login novamente.'); }
    if (r.status === 409 && dados.proxima_acao_vigente) {
      const v = dados.proxima_acao_vigente;
      const ok = confirm(
        `Este cliente já tem uma próxima ação:\n\n"${v.proxima_acao}"`
        + `${v.proxima_acao_data ? ` — ${v.proxima_acao_data}` : ''}\n\nSubstituir pela nova?`
      );
      if (!ok) return;
      return confirmarResumo({ substituir: true });
    }
    if (!r.ok) throw new Error(dados.erro || 'Não foi possível salvar.');
    const cliente = clienteDoResumo;
    RASCUNHO = null;
    toast('Resumo salvo no histórico.');
    abrirFicha(cliente);
    recarregarTelaAtiva();
  } catch (err) { toast(err.message, true); }
}

async function descartarResumo() {
  if (!confirm('Descartar este resumo? A transcrição vai junto e a extração precisaria ser refeita.')) return;
  try {
    await api('DELETE', `/api/resumos/${RASCUNHO.id}`);
    const cliente = clienteDoResumo;
    RASCUNHO = null;
    toast('Rascunho descartado. Nada foi salvo.');
    abrirFicha(cliente);
  } catch (err) { toast(err.message, true); }
}

async function verTranscricao(interacaoId) {
  try {
    const t = await api('GET', `/api/interacoes/${interacaoId}/transcricao`);
    if (!t.disponivel) {
      return toast(`A transcrição de origem já foi descartada (retenção de ${RETENCAO_DIAS} dias).`);
    }
    abrirModal(`
      <h1>Transcrição de origem</h1>
      <p class="subtitulo">Guardada até ${esc(fmtData(t.expira_em))}. Depois disso é descartada.</p>
      <pre class="transcricao-fonte">${esc(t.texto)}</pre>
      <div class="acoes-modal"><button type="button" class="btn" data-acao="fechar-resumo">Fechar</button></div>
    `);
  } catch (err) { toast(err.message, true); }
}

// Um listener por região, alvo por data-* (RNF-16).
modal.addEventListener('click', (e) => {
  const alvo = e.target.closest('[data-acao]');
  if (!alvo) return;
  const { acao, tipo, i, cliente, interacao } = alvo.dataset;

  if (acao === 'abrir-resumo') return abrirColarTranscricao(cliente);
  if (acao === 'ver-transcricao') return verTranscricao(interacao);
  if (acao === 'fechar-resumo') return fecharModal();
  if (acao === 'extrair') return extrairResumo();
  if (!RASCUNHO) return;

  if (acao === 'confirmar') return confirmarResumo();
  if (acao === 'descartar') return descartarResumo();
  if (acao === 'add') {
    coletarEdicoes();
    const vazio = tipo === 'proximos_passos'
      ? { texto: '', responsavel: null, prazo: null } : { texto: '' };
    RASCUNHO[tipo] = [...(RASCUNHO[tipo] || []), vazio];
    return renderRevisao();
  }
  if (acao === 'remover') {
    coletarEdicoes();
    RASCUNHO[tipo] = RASCUNHO[tipo].filter((_, idx) => String(idx) !== i);
    return renderRevisao();
  }
  if (acao === 'promover') {
    coletarEdicoes();
    const passo = RASCUNHO.proximos_passos[i];
    if (!passo || !passo.texto.trim()) return toast('Escreva o passo antes de promovê-lo.', true);
    if (!passo.prazo) return toast('Defina a data do passo para virar próxima ação.', true);
    RASCUNHO.promover_proxima_acao = { texto: passo.texto.trim(), data: passo.prazo };
    return renderRevisao();
  }
  if (acao === 'cancelar-promocao') {
    coletarEdicoes();
    delete RASCUNHO.promover_proxima_acao;
    return renderRevisao();
  }
});

function mostrarLogin() {
  // Higiene de sessão: o rascunho não pode ficar na tela para quem sentar depois (FR-025),
  // e a chave de API revelada não pode sobreviver ao fim da sessão.
  RASCUNHO = null;
  clienteDoResumo = null;
  chaveRevelada = null;
  fecharModal();
  // Fecha o modal e limpa a sessão em memória: sem isso, sair (ou a sessão
  // expirar) deixaria a última tela aberta — lista de usuários, chaves de API —
  // visível por cima do login para quem sentar no navegador em seguida.
  fecharModal();
  USUARIO = null; CSRF = null;
  document.getElementById('app').classList.add('escondido');
  document.getElementById('login').classList.remove('escondido');
}
function mostrarApp() {
  document.getElementById('login').classList.add('escondido');
  document.getElementById('app').classList.remove('escondido');
  document.getElementById('usuario-nome').textContent = USUARIO ? USUARIO.nome.split(' ')[0] : '';
  // itens de administração (usuários e chaves de API) só aparecem para admin.
  // Isto é conveniência de interface — quem manda é o requireAdmin no servidor.
  const ehAdmin = !!(USUARIO && USUARIO.papel === 'admin');
  document.getElementById('btnUsuarios').style.display = ehAdmin ? '' : 'none';
  document.getElementById('btnIntegracoes').style.display = ehAdmin ? '' : 'none';
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  erroEl.classList.add('escondido');
  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ email, senha }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.erro || 'Falha no login');
    USUARIO = d.usuario; CSRF = d.csrf;
    mostrarApp();
    carregarHoje();
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.classList.remove('escondido');
  }
});

async function sair() {
  try { await api('POST', '/api/auth/logout'); } catch (_) {}
  mostrarLogin(); // limpa USUARIO/CSRF e fecha o modal
}

// menu do usuário
const dropdown = document.getElementById('usuario-dropdown');
document.getElementById('btnUsuario').addEventListener('click', (e) => {
  e.stopPropagation(); dropdown.classList.toggle('escondido');
});
document.addEventListener('click', () => dropdown.classList.add('escondido'));
document.getElementById('btnSair').addEventListener('click', sair);
document.getElementById('btnIntegracoes').addEventListener('click', abrirIntegracoes);
document.getElementById('btnUsuarios').addEventListener('click', abrirUsuarios);
document.getElementById('btnSenha').addEventListener('click', abrirTrocarSenha);

// =================== USUÁRIOS (somente admin) ===================
const PAPEIS = { admin: 'Administrador', assistente: 'Assistente' };

async function abrirUsuarios() {
  const usuarios = await api('GET', '/api/usuarios');
  const linhas = usuarios.map(u => `
    <div class="item" style="cursor:default">
      <div class="info">
        <b>${esc(u.nome)}
          <span class="tag ${u.papel === 'admin' ? 'ganho' : ''}">${PAPEIS[u.papel] || esc(u.papel)}</span>
          ${u.id === USUARIO.id ? '<span class="tag">você</span>' : ''}</b>
        <small>${esc(u.email)} · desde ${esc(u.created_at)}</small>
      </div>
      <div style="display:flex; gap:8px">
        <button type="button" class="btn" data-acao="editar-usuario" data-id="${u.id}">Editar</button>
        ${u.id === USUARIO.id ? '' : `<button type="button" class="btn perigo" data-acao="excluir-usuario" data-id="${u.id}">Excluir</button>`}
      </div>
    </div>`).join('');

  abrirModal(`
    <span class="eyebrow">Quem acessa o CRM</span>
    <h1>Usuários</h1>
    <p class="sub">O <b>administrador</b> gerencia usuários e chaves de API. O <b>assistente</b> usa o
      CRM inteiro — cria, edita e exclui clientes — mas não administra acessos.
      Todos enxergam a mesma carteira de clientes.</p>

    <div class="ficha-secao">
      <h3>Cadastrar novo usuário</h3>
      <div class="linha">
        <div class="campo"><label>Nome *</label><input id="u_nome" placeholder="Maria Souza" /></div>
        <div class="campo"><label>E-mail *</label><input id="u_email" type="email" placeholder="maria@empresa.com" /></div>
      </div>
      <div class="linha">
        <div class="campo"><label>Senha inicial *</label><input id="u_senha" type="password" placeholder="mínimo 8 caracteres" /></div>
        <div class="campo"><label>Papel</label><select id="u_papel">
          <option value="assistente">Assistente</option>
          <option value="admin">Administrador</option>
        </select></div>
      </div>
      <button type="button" class="btn primario" data-acao="criar-usuario">Cadastrar usuário</button>
      <p class="sub" style="margin-top:10px">Combine a senha inicial com a pessoa — ela pode trocá-la
        depois em <b>Trocar minha senha</b>.</p>
    </div>

    <div class="ficha-secao">
      <h3>Usuários cadastrados</h3>
      <div class="lista">${linhas}</div>
    </div>
  `);
}

async function criarUsuario() {
  const dados = {
    nome: val('u_nome'), email: val('u_email'),
    senha: document.getElementById('u_senha').value, papel: val('u_papel'),
  };
  try {
    await api('POST', '/api/usuarios', dados);
    toast('Usuário cadastrado!');
    abrirUsuarios();
  } catch (err) { toast(err.message, true); }
}

async function abrirEditarUsuario(id) {
  const u = (await api('GET', '/api/usuarios')).find(x => x.id === id);
  if (!u) return toast('Usuário não encontrado.', true);
  const op = (v, label) => `<option value="${v}" ${v === u.papel ? 'selected' : ''}>${label}</option>`;

  abrirModal(`
    <h1>Editar usuário</h1>
    <p class="subtitulo">${esc(u.email)}</p>
    <div class="linha">
      <div class="campo"><label>Nome</label><input id="e_nome" value="${esc(u.nome)}" /></div>
      <div class="campo"><label>Papel</label><select id="e_papel">
        ${op('assistente', 'Assistente')}${op('admin', 'Administrador')}
      </select></div>
    </div>
    <div class="acoes-modal">
      <button type="button" class="btn primario" data-acao="salvar-usuario" data-id="${u.id}">Salvar</button>
      <button type="button" class="btn" data-acao="abrir-usuarios">Cancelar</button>
    </div>

    <div class="ficha-secao">
      <h3>Redefinir a senha</h3>
      <p class="sub">Use se a pessoa perdeu o acesso. Todas as sessões dela caem na hora
        e ela precisa entrar de novo com a senha nova.</p>
      <div class="campo">
        <label>Nova senha</label>
        <div style="display:flex; gap:10px">
          <input id="e_senha" type="password" placeholder="mínimo 8 caracteres" />
          <button type="button" class="btn" data-acao="redefinir-senha" data-id="${u.id}">Redefinir</button>
        </div>
      </div>
    </div>
  `);
}

async function salvarUsuario(id) {
  try {
    await api('PUT', '/api/usuarios/' + id, { nome: val('e_nome'), papel: val('e_papel') });
    toast('Usuário atualizado!');
    // se mudei a mim mesmo, a interface precisa refletir o novo papel
    if (id === USUARIO.id) {
      const me = await api('GET', '/api/auth/me');
      USUARIO = me.usuario; CSRF = me.csrf;
      mostrarApp();
    }
    abrirUsuarios();
  } catch (err) { toast(err.message, true); }
}

async function redefinirSenhaUsuario(id) {
  const senha = document.getElementById('e_senha').value;
  try {
    await api('PUT', `/api/usuarios/${id}/senha`, { senha });
    toast('Senha redefinida. Passe a nova senha para a pessoa.');
    abrirUsuarios();
  } catch (err) { toast(err.message, true); }
}

async function excluirUsuario(id) {
  if (!confirm('Excluir este usuário? Ele perde o acesso imediatamente. Os clientes cadastrados por ele continuam no CRM.')) return;
  try {
    await api('DELETE', '/api/usuarios/' + id);
    toast('Usuário excluído.');
    abrirUsuarios();
  } catch (err) { toast(err.message, true); }
}

// =================== TROCAR A PRÓPRIA SENHA ===================
function abrirTrocarSenha() {
  abrirModal(`
    <h1>Trocar minha senha</h1>
    <p class="sub">Ao salvar, as outras sessões da sua conta são encerradas — esta continua ativa.</p>
    <div class="campo"><label>Senha atual</label><input id="s_atual" type="password" /></div>
    <div class="campo"><label>Nova senha</label><input id="s_nova" type="password" placeholder="mínimo 8 caracteres" /></div>
    <div class="campo"><label>Repita a nova senha</label><input id="s_conf" type="password" /></div>
    <div class="acoes-modal">
      <button type="button" class="btn primario" data-acao="salvar-propria-senha">Salvar</button>
      <button type="button" class="btn" data-acao="fechar-modal">Cancelar</button>
    </div>
  `);
}

async function salvarPropriaSenha() {
  const senhaAtual = document.getElementById('s_atual').value;
  const senhaNova = document.getElementById('s_nova').value;
  if (senhaNova !== document.getElementById('s_conf').value) {
    return toast('A confirmação não confere com a nova senha.', true);
  }
  try {
    await api('PUT', '/api/auth/senha', { senhaAtual, senhaNova });
    toast('Senha alterada!');
    fecharModal();
  } catch (err) { toast(err.message, true); }
}

// =================== INTEGRAÇÕES (API KEYS) ===================
async function abrirIntegracoes() {
  const keys = await api('GET', '/api/keys');
  const linhas = keys.length ? keys.map(k => `
    <div class="item" style="cursor:default">
      <div class="info">
        <b>${esc(k.nome)} ${k.ativa ? '' : '<span class="tag perdido">revogada</span>'}</b>
        <small><code>${esc(k.prefixo)}…</code> · criada em ${esc(k.created_at)} ${k.ultimo_uso ? '· último uso ' + esc(k.ultimo_uso) : '· nunca usada'}</small>
      </div>
      ${k.ativa ? `<button type="button" class="btn perigo" data-acao="revogar-key" data-id="${k.id}">Revogar</button>` : ''}
    </div>`).join('') : '<div class="vazio">Nenhuma chave criada ainda.</div>';

  abrirModal(`
    <span class="eyebrow">Para automações &amp; IA</span>
    <h1>Chaves de <em>API</em></h1>
    <p class="sub">Crie uma chave por integração. Elas dão acesso de máquina à API <b>e ao servidor MCP</b>
      (<code>/mcp</code>, usado por agentes de IA remotos) — nunca use a sua senha para isso.
      A chave é mostrada uma única vez e pode ser revogada a qualquer momento.</p>
    <div class="campo" style="margin-top:16px">
      <label>Nova integração</label>
      <div style="display:flex; gap:10px">
        <input id="nova-key-nome" placeholder="Ex.: Agente do WhatsApp" />
        <button type="button" class="btn primario" data-acao="criar-key">Gerar chave</button>
      </div>
    </div>
    <div id="key-nova"></div>
    <div class="ficha-secao">
      <h3>Chaves existentes</h3>
      <div class="lista">${linhas}</div>
    </div>
  `);
}
// A chave em texto vive só nesta variável enquanto o modal está aberto. Guardá-la num
// atributo do DOM (era o que o onclick de copiar fazia) deixaria o segredo legível por
// qualquer extensão ou script que leia o documento.
let chaveRevelada = null;

async function criarKey() {
  const nome = document.getElementById('nova-key-nome').value.trim();
  if (!nome) return toast('Dê um nome para a integração.', true);
  try {
    const k = await api('POST', '/api/keys', { nome });
    chaveRevelada = k.chave;   // em memória, para o botão Copiar; nunca num atributo
    document.getElementById('key-nova').innerHTML = `
      <div class="key-revelada">
        <b>Chave criada — copie agora, ela não será mostrada de novo:</b>
        <code class="key-valor">${esc(k.chave)}</code>
        <button type="button" class="btn" data-acao="copiar-chave">Copiar</button>
      </div>`;
    toast('Chave gerada!');
    // atualiza a lista mantendo o bloco da chave revelada
    const revelada = document.getElementById('key-nova').innerHTML;
    await abrirIntegracoes();
    document.getElementById('key-nova').innerHTML = revelada;
    document.getElementById('nova-key-nome').value = '';
  } catch (err) { toast(err.message, true); }
}
async function revogarKey(id) {
  if (!confirm('Revogar esta chave? As integrações que a usam vão parar de funcionar.')) return;
  try { await api('DELETE', '/api/keys/' + id); toast('Chave revogada.'); abrirIntegracoes(); }
  catch (err) { toast(err.message, true); }
}

// O bloco `Object.assign(window, {...})` que existia aqui foi removido: ele servia apenas
// para os handlers inline (`onclick="abrirFicha(1)"`) enxergarem as funções, e não há mais
// handler inline algum.
//
// Ressalva honesta: isto NÃO tira as funções do objeto global. Em script clássico, toda
// `function` de topo já é propriedade de `window` por definição da linguagem — o que sumiu
// foi a re-exportação explícita, não o alcance. Tirar de fato exigiria envolver o arquivo
// num módulo ou IIFE, o que é refatoração de fundação e não desta feature.

// =================== INICIALIZAÇÃO ===================
(async function init() {
  try {
    const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (resp.ok) {
      const d = await resp.json();
      USUARIO = d.usuario; CSRF = d.csrf;
      mostrarApp();
      carregarHoje();
    } else {
      mostrarLogin();
    }
  } catch (_) {
    mostrarLogin();
  }
})();

// =================== DELEGAÇÃO GLOBAL DE EVENTOS ===================
// Um dispatcher para todo o app, alvo identificado por data-*. Nenhum handler em
// atributo HTML — é o que permite à CSP declarar `script-src 'self'` sem
// 'unsafe-inline' e sem script-src-attr, fechando o RNF-16.
//
// Antes disto, a CSP do produto declarava uma proteção contra XSS que não tinha: com
// 'unsafe-inline' ligado, o escape de saída era a única linha de defesa real.

const ACOES = {
  'ficha':                (id) => abrirFicha(id),
  'fechar-modal':         () => fecharModal(),
  'salvar-interacao':     (id) => salvarInteracao(id),
  'editar-cliente':       (id) => abrirFormulario(id),
  'exportar-cliente':     (id) => exportarCliente(id),
  'excluir-cliente':      (id) => excluirCliente(id),
  'salvar-cliente':       (id) => salvarCliente(id || null),
  'abrir-usuarios':       () => abrirUsuarios(),
  'criar-usuario':        () => criarUsuario(),
  'editar-usuario':       (id) => abrirEditarUsuario(id),
  'salvar-usuario':       (id) => salvarUsuario(id),
  'excluir-usuario':      (id) => excluirUsuario(id),
  'redefinir-senha':      (id) => redefinirSenhaUsuario(id),
  'salvar-propria-senha': () => salvarPropriaSenha(),
  'criar-key':            () => criarKey(),
  'revogar-key':          (id) => revogarKey(id),
  'copiar-chave':         () => {
    if (!chaveRevelada) return toast('A chave não está mais disponível.', true);
    navigator.clipboard.writeText(chaveRevelada).then(() => toast('Chave copiada!'));
  },
};

document.addEventListener('click', (e) => {
  const alvo = e.target.closest('[data-acao]');
  if (!alvo) return;
  const acao = ACOES[alvo.dataset.acao];
  if (!acao) return;              // ações do modal de resumo têm dispatcher próprio
  e.preventDefault();
  acao(alvo.dataset.id);
});

// Itens de lista e cartões do funil viram alvos de teclado: são `role="button"` com
// tabindex, então Enter e Espaço precisam funcionar como o clique (RNF-10).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const alvo = e.target.closest('[data-acao][role="button"]');
  if (!alvo) return;
  e.preventDefault();
  alvo.click();
});

// Esc fecha o modal. Na tela de revisão passa pela mesma confirmação do botão Descartar:
// fechar sem querer jogaria fora uma extração que custou dinheiro.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modal.classList.contains('escondido')) return;
  if (RASCUNHO) { descartarResumo(); return; }
  fecharModal();
});

// Arraste do funil, delegado no container.
const kanbanEl = document.getElementById('kanban');
if (kanbanEl) {
  kanbanEl.addEventListener('dragstart', (e) => {
    const cartao = e.target.closest('.cartao');
    if (cartao) iniciarArraste(cartao);
  });
  kanbanEl.addEventListener('dragend', (e) => {
    const cartao = e.target.closest('.cartao');
    if (cartao) fimArraste(cartao);
  });
  kanbanEl.addEventListener('dragover', (e) => {
    const coluna = e.target.closest('.coluna');
    if (!coluna) return;
    e.preventDefault();
    coluna.classList.add('dragover');
  });
  kanbanEl.addEventListener('dragleave', (e) => {
    const coluna = e.target.closest('.coluna');
    // relatedTarget fora da coluna evita o piscar ao passar sobre os filhos
    if (coluna && !coluna.contains(e.relatedTarget)) coluna.classList.remove('dragover');
  });
  kanbanEl.addEventListener('drop', (e) => {
    const coluna = e.target.closest('.coluna');
    if (!coluna) return;
    e.preventDefault();
    soltarCartao(coluna);
  });
}
