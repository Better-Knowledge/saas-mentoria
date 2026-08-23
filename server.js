// server.js — API REST + serve o frontend + servidor MCP autenticado (/mcp)
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const yaml = require('js-yaml');
const db = require('./db');
const auth = require('./auth');
const crm = require('./crm-service'); // lógica de domínio compartilhada por REST e MCP

// Spec OpenAPI (carregado do openapi.yaml na raiz do projeto) — só para validar
// no boot que o arquivo está íntegro; o Scalar consome o YAML direto de /openapi.yaml.
const openapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'));

// Bundle do Scalar servido pelo próprio app (nunca de CDN): a CSP permite apenas
// 'self' em script-src, e afrouxá-la só para a documentação não se justifica.
// O caminho é derivado do entrypoint do pacote porque o campo "exports" dele
// não publica subcaminhos — require.resolve('@scalar/api-reference/...') falharia.
const SCALAR_BUNDLE = path.join(
  path.dirname(require.resolve('@scalar/api-reference')), 'browser', 'standalone.js'
);

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Segurança de transporte / cabeçalhos ----
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      // script-src 'self' SEM 'unsafe-inline', e sem script-src-attr: o front não tem
      // um único handler em atributo HTML (todos os eventos são delegados, com o alvo
      // identificado por data-*). helmet mantém script-src-attr 'none' por padrão, que
      // é o que bloqueia onclick e afins — e é isso que faz a CSP ser uma segunda linha
      // de defesa real contra XSS, em vez de uma promessa na documentação.
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  hsts: process.env.NODE_ENV === 'production', // ativar atrás de HTTPS
}));
// Limite de corpo por rota. A transcrição de uma reunião longa passa de 64 KB com
// facilidade, mas baixar o limite global para acomodar um caso enfraqueceria todas as
// outras rotas — então a folga vale só onde o dado legitimamente é grande (RNF-04).
const jsonPadrao = express.json({ limit: '64kb' });
const jsonTranscricao = express.json({ limit: '512kb' });
const ROTA_TRANSCRICAO = /^\/api\/clientes\/[^/]+\/resumos\/?$/;
app.use((req, res, next) => (
  ROTA_TRANSCRICAO.test(req.path) ? jsonTranscricao : jsonPadrao
)(req, res, next));
app.use(cookieParser());

// limite geral + limite específico para login (anti brute force) + limite do MCP
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600 }));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { erro: 'Muitas tentativas. Tente mais tarde.' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, message: { erro: 'Muitas requisições. Tente mais tarde.' } });
// Quarto nível de limite, e o único cujo custo de abuso é financeiro: cada extração
// aciona um serviço externo pago. Sem teto, uma chave vazada vira uma fatura.
const extracaoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  message: { erro: 'Limite de extrações por hora atingido. Tente mais tarde.' },
});

// quem é o autor de uma escrita (auditoria confiável, derivada da credencial)
const autorDe = (req) => (req.principal.tipo === 'humano' ? 'humano' : 'ia');

// =================== AUTENTICAÇÃO ===================
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, senha } = req.body || {};
  const u = auth.buscarUsuarioPorEmail(email);
  if (!u || !auth.verificarSenha(senha || '', u.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  }
  const { token, csrf } = auth.criarSessao(u.id);
  auth.setCookieSessao(res, token);
  res.json({ usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel }, csrf });
});

app.post('/api/auth/logout', auth.requireAuth, (req, res) => {
  if (req.cookies && req.cookies[auth.COOKIE_NOME]) auth.destruirSessao(req.cookies[auth.COOKIE_NOME]);
  auth.limparCookieSessao(res);
  res.json({ ok: true });
});

// quem sou eu (a UI chama no carregamento p/ saber se há sessão)
app.get('/api/auth/me', (req, res) => {
  const s = auth.obterSessao(req.cookies && req.cookies[auth.COOKIE_NOME]);
  if (!s) return res.status(401).json({ erro: 'Não autenticado' });
  res.json({ usuario: { id: s.usuario_id, nome: s.nome, email: s.email, papel: s.papel }, csrf: s.csrf });
});

// troca da própria senha (qualquer usuário logado, via sessão)
app.put('/api/auth/senha', auth.requireAuth, auth.csrfProtect, (req, res) => {
  if (req.principal.credencial !== 'sessao') {
    return res.status(403).json({ erro: 'Apenas usuários logados na interface' });
  }
  const token = req.cookies && req.cookies[auth.COOKIE_NOME];
  res.json(auth.trocarPropriaSenha(req.principal.id, req.body || {}, token));
});

// =================== USUÁRIOS (somente admin, via sessão) ===================
app.get('/api/usuarios', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(auth.listarUsuarios());
});

app.post('/api/usuarios', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, (req, res) => {
  const { nome, email, senha, papel } = req.body || {};
  res.status(201).json(auth.cadastrarUsuario({ nome, email, senha, papel }));
});

app.put('/api/usuarios/:id', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, (req, res) => {
  const { nome, papel } = req.body || {};
  res.json(auth.atualizarUsuario(req.params.id, { nome, papel }));
});

// admin redefine a senha de outra pessoa (derruba as sessões dela)
app.put('/api/usuarios/:id/senha', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, (req, res) => {
  res.json(auth.redefinirSenha(req.params.id, (req.body || {}).senha));
});

app.delete('/api/usuarios/:id', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, (req, res) => {
  res.json(auth.excluirUsuario(req.params.id, req.principal.id));
});

// =================== API KEYS (somente admin, via sessão) ===================
app.get('/api/keys', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(auth.listarApiKeys());
});
app.post('/api/keys', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, (req, res) => {
  const nome = (req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'Dê um nome para a integração' });
  const k = auth.criarApiKey({ nome, criadaPor: req.principal.id });
  res.status(201).json(k); // inclui a chave em texto — mostrada UMA vez
});
app.delete('/api/keys/:id', auth.requireAuth, auth.csrfProtect, auth.requireAdmin, (req, res) => {
  const n = auth.revogarApiKey(req.params.id);
  if (!n) return res.status(404).json({ erro: 'Chave não encontrada' });
  res.json({ ok: true });
});

// =================== CLIENTES (tudo protegido — delega ao crm-service) ===================
app.get('/api/clientes', auth.requireAuth, (req, res) => {
  res.json(crm.listarClientes());
});

app.get('/api/clientes/:id', auth.requireAuth, (req, res) => {
  res.json(crm.obterCliente(req.params.id));
});

app.post('/api/clientes', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.status(201).json(crm.criarCliente(req.body, autorDe(req)));
});

app.put('/api/clientes/:id', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.json(crm.atualizarCliente(req.params.id, req.body));
});

app.put('/api/clientes/:id/etapa', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.json(crm.moverEtapa(req.params.id, req.body || {}));
});

// LGPD: exportar (protegido)
app.get('/api/clientes/:id/export', auth.requireAuth, (req, res) => {
  const cliente = crm.exportarCliente(req.params.id);
  res.setHeader('Content-Disposition', `attachment; filename="cliente-${req.params.id}.json"`);
  res.json(cliente);
});

// LGPD: excluir
app.delete('/api/clientes/:id', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.json(crm.excluirCliente(req.params.id));
});

// =================== INTERACOES ===================
app.get('/api/clientes/:id/interacoes', auth.requireAuth, (req, res) => {
  res.json(crm.listarInteracoes(req.params.id));
});

app.post('/api/clientes/:id/interacoes', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.status(201).json(crm.registrarInteracao(req.params.id, req.body.texto, autorDe(req)));
});

// =================== TELA "HOJE" ===================
app.get('/api/hoje', auth.requireAuth, (req, res) => {
  res.json(crm.acoesHoje());
});

// =================== DASHBOARD ===================
app.get('/api/dashboard', auth.requireAuth, (req, res) => {
  res.json(crm.dashboard());
});

// =================== RESUMO DE REUNIÃO (feature 002) ===================
// Estas rotas só traduzem HTTP: toda a regra está em crm.resumoReuniao.
const resumo = crm.resumoReuniao;

// Cria o rascunho a partir da transcrição colada. NÃO grava nada no histórico.
app.post('/api/clientes/:id/resumos', extracaoLimiter, auth.requireAuth, auth.csrfProtect,
  async (req, res, next) => {
    try {
      const r = await resumo.criarRascunho(
        req.params.id, (req.body || {}).transcricao, req.principal
      );
      res.status(201).json(r);
    } catch (e) { next(e); }
  });

app.get('/api/resumos/:id', auth.requireAuth, (req, res) => {
  res.json(resumo.obterRascunho(req.params.id, req.principal));
});

app.post('/api/resumos/:id/confirmar', auth.requireAuth, auth.csrfProtect, (req, res) => {
  res.status(201).json(resumo.confirmarRascunho(req.params.id, req.body || {}, req.principal));
});

app.delete('/api/resumos/:id', auth.requireAuth, auth.csrfProtect, (req, res) => {
  resumo.descartarRascunho(req.params.id, req.principal);
  res.status(204).end();
});

// Fonte conferível. Transcrição expirada devolve 200 com disponivel:false — a
// retenção cumprida não é erro, e a interface não deve mostrar falha por causa dela.
app.get('/api/interacoes/:id/transcricao', auth.requireAuth, (req, res) => {
  res.json(resumo.obterTranscricao(req.params.id));
});

// ---- documentação da API: Scalar em /docs (+ spec cru em /openapi.yaml) ----
app.get('/openapi.yaml', (req, res) => {
  res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.yaml'));
});

// Bundle local do Scalar. Imutável por versão do pacote, então cacheia forte.
app.get('/docs/scalar.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.sendFile(SCALAR_BUNDLE);
});

// Nota sobre o console desta página: o Scalar tenta consultar o registry dele
// (api.scalar.com/vector/registry/*), um catálogo de APIs públicas que não serve
// para nada numa doc auto-hospedada. A CSP bloqueia — e deve continuar bloqueando.
// Os dois erros no console são o efeito visível disso; NÃO libere connect-src
// para silenciá-los: seria abrir a doc para um terceiro sem ganho nenhum.
app.get('/docs', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${openapiSpec.info.title} — Documentação</title>
  <!-- Mesma Inter do app, de uma origem que a CSP já permite. O Scalar buscaria
       as próprias fontes em fonts.scalar.com, que a CSP bloqueia (e que vazaria
       o IP de quem lê a doc) — por isso withDefaultFonts: false abaixo. -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root { --scalar-font: 'Inter', system-ui, sans-serif; --scalar-font-code: 'JetBrains Mono', monospace; }
    body { margin: 0; font-family: var(--scalar-font); }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="/docs/scalar.js"></script>
  <script>
    Scalar.createApiReference('#app', {
      url: '/openapi.yaml',
      theme: 'default',
      withDefaultFonts: false,
      documentDownloadType: 'yaml',
      // pré-seleciona a chave de API no botão Authorize (caminho de automação).
      // persistAuth fica desligado de propósito: nada de credencial no localStorage.
      authentication: { preferredSecurityScheme: 'bearerAuth' },
    });
  </script>
</body>
</html>`);
});

// caminho antigo do Swagger UI — mantido para não quebrar links já compartilhados
app.get('/api-docs', (req, res) => res.redirect(301, '/docs'));

// ---- bootstrap assíncrono: monta o servidor MCP (ESM) e só então estáticos + erro + listen ----
async function iniciar() {
  // Servidor MCP autenticado: o módulo é ESM, carregado por import() dinâmico a partir do CommonJS.
  // requireBearer garante que nenhuma ferramenta executa sem credencial válida (sem anônimo).
  const { criarHandlerMcp } = await import('./mcp/server.mjs');
  const handlerMcp = criarHandlerMcp({ crmService: crm });
  app.post('/mcp', mcpLimiter, auth.requireBearer, (req, res) => handlerMcp(req, res));

  // ---- arquivos estáticos (front) ----
  app.use(express.static(path.join(__dirname, 'public')));

  // ---- handler global de erros (não derruba o processo) ----
  app.use((err, req, res, next) => {
    // corpo acima do limite da rota — resposta de negócio, não 500 genérico
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ erro: 'Conteudo grande demais para esta rota' });
    }
    // erros de domínio (crm-service) e de gestão de acesso (auth) viram
    // 400/403/404/409 de negócio, em vez de 500 genérico
    if (err instanceof crm.ErroDominio || err instanceof auth.ErroAuth) {
      const corpo = { erro: err.message };
      // 409 de próxima ação carrega o valor vigente, para a interface poder mostrar
      // o que seria substituído antes de pedir confirmação
      if (err.proxima_acao_vigente) corpo.proxima_acao_vigente = err.proxima_acao_vigente;
      return res.status(err.status).json(corpo);
    }
    // falha do serviço externo de IA: 503 (ou 400 de entrada), nunca gravação parcial
    if (err && err.name === 'ErroIa') {
      return res.status(err.status).json({ erro: err.message, ia_configurada: err.configurado });
    }
    // A mensagem real fica no log; o cliente recebe genérico. Nada de transcrição aqui.
    console.error('Erro:', err.message);
    res.status(500).json({ erro: 'Erro interno' });
  });

  auth.bootstrapAdmin();

  // Retenção (FR-026a): purga no boot — cobre o container que reinicia todo dia — e a
  // cada 24 h, para o container que fica meses de pé. unref() impede que o timer
  // segure o processo no encerramento. O mesmo trabalho roda à mão por
  // `npm run purgar`, que é o que torna a retenção testável sem esperar 90 dias.
  const purgar = () => {
    try {
      const r = crm.resumoReuniao.purgarExpirados();
      if (r.transcricoes || r.rascunhos) {
        console.log(`[retencao] ${r.transcricoes} transcricao(oes) e ${r.rascunhos} rascunho(s) descartados.`);
      }
    } catch (e) {
      console.error('[retencao] falha ao purgar:', e.message);
    }
  };
  purgar();
  setInterval(purgar, 24 * 60 * 60 * 1000).unref();

  return app;
}

// Exportado para os testes (supertest monta o app sem abrir porta).
module.exports = { criarApp: iniciar };

// Só escuta quando executado diretamente — `require('./server')` não sobe servidor.
if (require.main === module) {
  iniciar()
    .then((a) => a.listen(PORT, () => console.log(`Mini CRM rodando em http://localhost:${PORT}`)))
    .catch((e) => {
      console.error('Falha ao iniciar:', e);
      process.exit(1);
    });
}
