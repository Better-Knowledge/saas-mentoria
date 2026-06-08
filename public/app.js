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
let ENT = null; // entitlements do plano (features) — define o que a UI de IA mostra
let OPERADOR = false; // operador de plataforma — habilita o painel cross-tenant

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
    if (tela === 'operador') carregarOperador();
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
    <div class="item" onclick="abrirFicha('${c.id}')">
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
         onclick="abrirFicha('${c.id}')">
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
    <div class="item" onclick="abrirFicha('${c.id}')">
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

    <div class="ficha-secao" id="secao-ia">
      <h3>IA &amp; Documentos</h3>
      <div id="ia-area"><div class="vazio">Carregando…</div></div>
    </div>

    <div class="ficha-secao">
      <h3>Histórico de interações</h3>
      <div class="campo">
        <textarea id="novaInteracao" placeholder="Anote uma conversa, reunião ou observação..."></textarea>
      </div>
      <button class="btn primario" onclick="salvarInteracao('${c.id}')">+ Adicionar anotação</button>
      <div style="margin-top:14px">${interacoes}</div>
    </div>

    <div class="acoes-modal">
      <button class="btn primario" onclick="abrirFormulario('${c.id}')">Editar</button>
      <button class="btn" onclick="exportarCliente('${c.id}')">Exportar dados (LGPD)</button>
      <button class="btn perigo" onclick="excluirCliente('${c.id}')">Excluir (LGPD)</button>
    </div>
  `);
  carregarSecaoIA(c.id);
}

// =================== IA & DOCUMENTOS (na ficha) ===================
async function carregarSecaoIA(id) {
  const area = document.getElementById('ia-area');
  if (!area) return;
  const vip = !!(ENT && ENT.features && ENT.features.whatsapp_ia);
  let cfg = {}, docs = [];
  try { cfg = await api('GET', `/api/clientes/${id}/ai-config`); } catch (_) { cfg = {}; }
  try { docs = await api('GET', `/api/clientes/${id}/documentos`); } catch (_) { docs = []; }

  const toggles = `
    <label class="ia-toggle"><input type="checkbox" id="cfg_auto_sentimento" ${cfg.auto_sentimento ? 'checked' : ''}
      onchange="salvarAiConfig('${id}')"> Análise de sentimento automática</label>
    <label class="ia-toggle"><input type="checkbox" id="cfg_auto_resposta" ${cfg.auto_resposta ? 'checked' : ''}
      ${vip ? '' : 'disabled'} onchange="salvarAiConfig('${id}')"> Responder sozinho (auto-resposta)${vip ? '' : ' — requer plano VIP'}</label>
    <div class="campo"><label>Persona / diretrizes da IA</label>
      <textarea id="cfg_persona" placeholder="Ex.: Tom acolhedor; ofereça uma call de diagnóstico gratuita...">${esc(cfg.persona || '')}</textarea></div>
    <button class="btn" onclick="salvarAiConfig('${id}')">Salvar configuração</button>`;

  const acoes = vip ? `
    <div class="ia-acoes">
      <span>Usar as últimas <input type="number" id="ia_n" value="20" min="1" max="200" style="width:64px"> mensagens:</span>
      <button class="btn" onclick="gerarArtefatoIA('${id}','transcricao')">Transcrever</button>
      <button class="btn" onclick="gerarArtefatoIA('${id}','resumo')">Resumir</button>
      <button class="btn" onclick="gerarArtefatoIA('${id}','documento')">Gerar documento</button>
      <button class="btn" onclick="gerarArtefatoIA('${id}','proposta')">Gerar proposta</button>
    </div>` : '<div class="vazio">As ações de IA sobre a conversa exigem o plano VIP.</div>';

  const lista = (docs && docs.length) ? docs.map(d => `
    <div class="doc-item">
      <span class="badge-doc">${esc(d.tipo)}</span>
      <span class="doc-titulo">${esc(d.titulo)}</span>
      ${d.gerado_por_ia ? '<span class="badge-ia">IA</span>' : ''}
      <span class="doc-acoes">
        <button class="btn pequeno" onclick="verDocumento('${id}','${d.id}')">Ver</button>
        <button class="btn pequeno perigo" onclick="excluirDocumento('${id}','${d.id}')">Excluir</button>
      </span>
    </div>`).join('') : '<div class="vazio">Nenhum documento ainda.</div>';

  area.innerHTML = `${toggles}<hr class="ia-sep">${acoes}<div class="ia-docs"><h4>Documentos do lead</h4>${lista}</div>`;
}

async function salvarAiConfig(id) {
  const patch = {
    auto_sentimento: document.getElementById('cfg_auto_sentimento').checked,
    persona: document.getElementById('cfg_persona').value,
  };
  const respChk = document.getElementById('cfg_auto_resposta');
  if (respChk && !respChk.disabled) patch.auto_resposta = respChk.checked;
  try {
    await api('PUT', `/api/clientes/${id}/ai-config`, patch);
    toast('Configuração de IA salva!');
    carregarSecaoIA(id);
  } catch (err) {
    toast(err.message, true);
    carregarSecaoIA(id); // reverte o checkbox ao estado real
  }
}

async function gerarArtefatoIA(id, tipo) {
  const nEl = document.getElementById('ia_n');
  const ultimas_n = nEl ? parseInt(nEl.value, 10) || 20 : 20;
  const corpo = { tipo, selecao: { ultimas_n } };
  if (tipo === 'documento') corpo.instrucao = prompt('Instrução opcional para o documento (enter para padrão):') || '';
  if (tipo === 'proposta') corpo.brief = prompt('Brief da proposta (escopo, valores, condições):') || '';
  toast('Gerando com IA…');
  try {
    await api('POST', `/api/clientes/${id}/ai/acao`, corpo);
    toast('Documento gerado!');
    abrirFicha(id); // recarrega a ficha (histórico + documentos)
  } catch (err) { toast(err.message, true); }
}

async function verDocumento(id, docId) {
  let d;
  try { d = await api('GET', `/api/clientes/${id}/documentos/${docId}`); }
  catch (err) { return toast(err.message, true); }
  abrirModal(`
    <h1>${esc(d.titulo)}</h1>
    <p class="subtitulo">${esc(d.tipo)}${d.gerado_por_ia ? ' · gerado por IA' : ''}</p>
    <pre class="doc-conteudo">${esc(d.conteudo)}</pre>
    <div class="acoes-modal">
      <button class="btn primario" onclick="baixarDocumento('${id}','${docId}')">Baixar (.md)</button>
      <button class="btn" onclick="abrirFicha('${id}')">Voltar ao lead</button>
    </div>
  `);
}

async function baixarDocumento(id, docId) {
  let d;
  try { d = await api('GET', `/api/clientes/${id}/documentos/${docId}`); }
  catch (err) { return toast(err.message, true); }
  const blob = new Blob([d.conteudo || ''], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(d.titulo || 'documento').replace(/[^\w.-]+/g, '_')}.md`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}

async function excluirDocumento(id, docId) {
  if (!confirm('Excluir este documento?')) return;
  try { await api('DELETE', `/api/clientes/${id}/documentos/${docId}`); toast('Documento excluído.'); carregarSecaoIA(id); }
  catch (err) { toast(err.message, true); }
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
      <button class="btn primario" onclick="salvarCliente(${id ? `'${id}'` : 'null'})">Salvar</button>
      <button class="btn" onclick="${id ? `abrirFicha('${id}')` : 'fecharModal()'}">Cancelar</button>
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
  // mostra a aba do operador só para o operador de plataforma
  document.getElementById('aba-operador').style.display = OPERADOR ? '' : 'none';
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
    USUARIO = d.usuario; CSRF = d.csrf; ENT = d.entitlements; OPERADOR = !!d.operador; if (d.org) USUARIO.papel = d.org.papel;
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

// =================== PAINEL DO OPERADOR (somente leitura) ===================
function fmtUSD(micro) { return 'US$ ' + ((Number(micro) || 0) / 1e6).toFixed(2); }
function fmtDataHora(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('pt-BR'); }

async function carregarOperador() {
  const cards = document.getElementById('op-overview');
  const lista = document.getElementById('op-orgs');
  cards.innerHTML = '<div class="vazio">Carregando…</div>'; lista.innerHTML = '';
  let ov, orgs;
  try { [ov, orgs] = await Promise.all([api('GET', '/api/operator/overview'), api('GET', '/api/operator/orgs')]); }
  catch (err) { cards.innerHTML = `<div class="vazio">${esc(err.message)}</div>`; return; }

  const card = (rotulo, valor) => `<div class="op-card"><span class="op-num">${valor}</span><span class="op-rot">${rotulo}</span></div>`;
  const assin = (ov.porAssinatura || []).map(s => `${esc(s.plano)}/${esc(s.status)}: ${s.n}`).join(' · ') || '—';
  cards.innerHTML =
    card('Organizações', ov.totalOrgs) +
    card('Usuários', ov.totalUsuarios) +
    card('Clientes (total)', ov.totalClientes) +
    card('Custo de IA (mês)', fmtUSD(ov.totalAiMicro)) +
    `<div class="op-card largo"><span class="op-rot">Assinaturas</span><span class="op-assin">${assin}</span></div>`;

  lista.innerHTML = '<h3 class="op-titulo">Organizações</h3>' + (orgs || []).map(o => `
    <div class="item op-org" onclick="verDetalheOrg('${o.id}')">
      <div>
        <strong>${esc(o.nome)}</strong>
        <span class="badge-doc">${esc(o.plano || 'sem plano')}</span>
        <span class="badge-doc">${esc(o.status || 's/ assinatura')}</span>
        ${o.estado !== 'ativa' ? `<span class="badge-doc" style="color:var(--danger)">${esc(o.estado)}</span>` : ''}
      </div>
      <small>${o.clientes} clientes · ${o.membros} membros · IA ${fmtUSD(o.ai_custo_micro_periodo)} · desde ${fmtDataHora(o.created_at)}</small>
    </div>`).join('');
}

async function verDetalheOrg(id) {
  let d;
  try { d = await api('GET', `/api/operator/orgs/${id}`); }
  catch (err) { return toast(err.message, true); }
  const s = d.assinatura || {};
  const membros = (d.membros || []).map(m => `<div class="dado"><span>${esc(m.papel)}:</span> ${esc(m.nome)} (${esc(m.email)})</div>`).join('') || '<div class="vazio">Sem membros.</div>';
  const usoIA = (d.uso_ia || []).map(u => `<div class="dado"><span>${esc(u.tarefa)}:</span> ${u.chamadas} chamadas · ${fmtUSD(u.micro)}</div>`).join('') || '<div class="vazio">Sem uso de IA no mês.</div>';
  const cobr = (d.cobranca || []).map(c => `<div class="dado"><span>${fmtDataHora(c.created_at)}:</span> ${esc(c.tipo || '—')}</div>`).join('') || '<div class="vazio">Sem eventos de cobrança.</div>';
  abrirModal(`
    <h1>${esc(d.org.nome)}</h1>
    <p class="subtitulo">Estado: ${esc(d.org.estado)} · desde ${fmtDataHora(d.org.created_at)}</p>
    <div class="ficha-secao">
      <h3>Assinatura</h3>
      <div class="dado"><span>Plano:</span> ${esc(s.plano_nome || s.plano || '—')}</div>
      <div class="dado"><span>Status:</span> ${esc(s.status || '—')}</div>
      <div class="dado"><span>Trial até:</span> ${fmtDataHora(s.trial_end)}</div>
      <div class="dado"><span>Período até:</span> ${fmtDataHora(s.current_period_end)}</div>
    </div>
    <div class="ficha-secao">
      <h3>Uso (mês)</h3>
      <div class="dado"><span>Clientes:</span> ${d.metricas.clientes}</div>
      <div class="dado"><span>Custo de IA:</span> ${fmtUSD(d.metricas.ai_custo_micro_periodo)}</div>
      ${usoIA}
    </div>
    <div class="ficha-secao"><h3>Membros</h3>${membros}</div>
    <div class="ficha-secao"><h3>Cobrança (últimos eventos)</h3>${cobr}</div>
    <div class="acoes-modal"><button class="btn" onclick="fecharModal()">Fechar</button></div>
  `);
}

// expor funcoes usadas no HTML inline
Object.assign(window, {
  abrirFicha, abrirFormulario, salvarCliente, salvarInteracao, exportarCliente, excluirCliente,
  iniciarArraste, fimArraste, permitirSolta, sairColuna, soltarCartao,
  criarKey, revogarKey,
  carregarSecaoIA, salvarAiConfig, gerarArtefatoIA, verDocumento, baixarDocumento, excluirDocumento,
  carregarOperador, verDetalheOrg,
});

// =================== INICIALIZAÇÃO ===================
(async function init() {
  try {
    const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (resp.ok) {
      const d = await resp.json();
      USUARIO = d.usuario; CSRF = d.csrf; ENT = d.entitlements; OPERADOR = !!d.operador; if (d.org) USUARIO.papel = d.org.papel;
      mostrarApp();
      carregarHoje();
    } else {
      mostrarLogin();
    }
  } catch (_) {
    mostrarLogin();
  }
})();
