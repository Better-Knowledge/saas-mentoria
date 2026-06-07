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
    if (tela === 'funil') carregarFunil();
    if (tela === 'clientes') carregarClientes();
  });
});

// ---- Modal ----
const modal = document.getElementById('modal');
const modalCorpo = document.getElementById('modal-corpo');
document.getElementById('fecharModal').addEventListener('click', fecharModal);
modal.addEventListener('click', e => { if (e.target === modal) fecharModal(); });
function abrirModal(html) { modalCorpo.innerHTML = html; modal.classList.remove('escondido'); }
function fecharModal() { modal.classList.add('escondido'); modalCorpo.innerHTML = ''; }

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
    <div class="item" onclick="abrirFicha(${c.id})">
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
      <div class="coluna" data-etapa="${et.id}"
           ondragover="permitirSolta(event)" ondragleave="sairColuna(event)" ondrop="soltarCartao(event)">
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
    <div class="cartao" draggable="true" data-id="${c.id}"
         ondragstart="iniciarArraste(event)" ondragend="fimArraste(event)"
         onclick="abrirFicha(${c.id})">
      <b>${esc(c.nome)}</b>
      <small>${esc(c.empresa || '')}</small>
      ${c.valor_estimado ? `<div class="valor">${fmtMoeda(c.valor_estimado)}</div>` : ''}
      ${tag}
    </div>`;
}
// drag & drop
let arrastandoId = null;
function iniciarArraste(e) { arrastandoId = e.target.dataset.id; e.target.classList.add('arrastando'); e.stopPropagation(); }
function fimArraste(e) { e.target.classList.remove('arrastando'); }
function permitirSolta(e) { e.preventDefault(); e.currentTarget.classList.add('dragover'); }
function sairColuna(e) { e.currentTarget.classList.remove('dragover'); }
async function soltarCartao(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const novaEtapa = e.currentTarget.dataset.etapa;
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
    <div class="item" onclick="abrirFicha(${c.id})">
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
      <div class="meta">${esc(i.data)}${i.gerado_por_ia ? '<span class="badge-ia">IA</span>' : ''}</div>
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
      <button class="btn primario" onclick="salvarInteracao(${c.id})">+ Adicionar anotação</button>
      <div style="margin-top:14px">${interacoes}</div>
    </div>

    <div class="acoes-modal">
      <button class="btn primario" onclick="abrirFormulario(${c.id})">Editar</button>
      <button class="btn" onclick="exportarCliente(${c.id})">Exportar dados (LGPD)</button>
      <button class="btn perigo" onclick="excluirCliente(${c.id})">Excluir (LGPD)</button>
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
      <button class="btn primario" onclick="salvarCliente(${id || 'null'})">Salvar</button>
      <button class="btn" onclick="${id ? `abrirFicha(${id})` : 'fecharModal()'}">Cancelar</button>
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
  if (ativa === 'funil') carregarFunil();
  if (ativa === 'clientes') carregarClientes();
}

// =================== LOGIN / SESSÃO ===================
function mostrarLogin() {
  document.getElementById('app').classList.add('escondido');
  document.getElementById('login').classList.remove('escondido');
}
function mostrarApp() {
  document.getElementById('login').classList.add('escondido');
  document.getElementById('app').classList.remove('escondido');
  document.getElementById('usuario-nome').textContent = USUARIO ? USUARIO.nome.split(' ')[0] : '';
  // some o botão de integrações se não for admin
  document.getElementById('btnIntegracoes').style.display = (USUARIO && ['owner', 'admin'].includes(USUARIO.papel)) ? '' : 'none';
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
    USUARIO = d.usuario; CSRF = d.csrf; if (d.org) USUARIO.papel = d.org.papel;
    mostrarApp();
    carregarHoje();
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.classList.remove('escondido');
  }
});

async function sair() {
  try { await api('POST', '/api/auth/logout'); } catch (_) {}
  USUARIO = null; CSRF = null;
  mostrarLogin();
}

// menu do usuário
const dropdown = document.getElementById('usuario-dropdown');
document.getElementById('btnUsuario').addEventListener('click', (e) => {
  e.stopPropagation(); dropdown.classList.toggle('escondido');
});
document.addEventListener('click', () => dropdown.classList.add('escondido'));
document.getElementById('btnSair').addEventListener('click', sair);
document.getElementById('btnIntegracoes').addEventListener('click', abrirIntegracoes);

// =================== INTEGRAÇÕES (API KEYS) ===================
async function abrirIntegracoes() {
  const keys = await api('GET', '/api/keys');
  const linhas = keys.length ? keys.map(k => `
    <div class="item" style="cursor:default">
      <div class="info">
        <b>${esc(k.nome)} ${k.ativa ? '' : '<span class="tag perdido">revogada</span>'}</b>
        <small><code>${esc(k.prefixo)}…</code> · criada em ${esc(k.created_at)} ${k.ultimo_uso ? '· último uso ' + esc(k.ultimo_uso) : '· nunca usada'}</small>
      </div>
      ${k.ativa ? `<button class="btn perigo" onclick="revogarKey(${k.id})">Revogar</button>` : ''}
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
        <button class="btn primario" onclick="criarKey()">Gerar chave</button>
      </div>
    </div>
    <div id="key-nova"></div>
    <div class="ficha-secao">
      <h3>Chaves existentes</h3>
      <div class="lista">${linhas}</div>
    </div>
  `);
}
async function criarKey() {
  const nome = document.getElementById('nova-key-nome').value.trim();
  if (!nome) return toast('Dê um nome para a integração.', true);
  try {
    const k = await api('POST', '/api/keys', { nome });
    document.getElementById('key-nova').innerHTML = `
      <div class="key-revelada">
        <b>Chave criada — copie agora, ela não será mostrada de novo:</b>
        <code class="key-valor">${esc(k.chave)}</code>
        <button class="btn" onclick="navigator.clipboard.writeText('${k.chave}').then(()=>toast('Chave copiada!'))">Copiar</button>
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

// expor funcoes usadas no HTML inline
Object.assign(window, {
  abrirFicha, abrirFormulario, salvarCliente, salvarInteracao, exportarCliente, excluirCliente,
  iniciarArraste, fimArraste, permitirSolta, sairColuna, soltarCartao,
  criarKey, revogarKey,
});

// =================== INICIALIZAÇÃO ===================
(async function init() {
  try {
    const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (resp.ok) {
      const d = await resp.json();
      USUARIO = d.usuario; CSRF = d.csrf; if (d.org) USUARIO.papel = d.org.papel;
      mostrarApp();
      carregarHoje();
    } else {
      mostrarLogin();
    }
  } catch (_) {
    mostrarLogin();
  }
})();
