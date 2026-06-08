// tenancy/plan-gating.js — middlewares de gating de plano (impostos NO SERVIDOR, Princípio VI).
// requireAccess: bloqueia escrita quando a assinatura não dá acesso (suspensa/expirada).
// requirePlan(feature): exige uma feature do plano (ex.: 'whatsapp_ia', 'relatorios_avancados').
// O limite de clientes é imposto em crm-service.criarCliente (vale para REST, MCP e Gordon).
const billing = require('../billing/plans');

// Carrega (e memoiza no req) os entitlements da organização do principal.
async function carregarEntitlements(req) {
  if (req._ents) return req._ents;
  const sub = await billing.assinaturaDaOrg(req.principal.org_id);
  req._ents = billing.entitlements(sub);
  return req._ents;
}

function requireAccess(req, res, next) {
  carregarEntitlements(req)
    .then((ents) => {
      if (!ents.acesso) return res.status(402).json({ erro: 'Assinatura suspensa ou expirada', billing: true });
      next();
    })
    .catch(next);
}

function requirePlan(feature) {
  return (req, res, next) => {
    carregarEntitlements(req)
      .then((ents) => {
        if (!ents.acesso) return res.status(402).json({ erro: 'Assinatura suspensa ou expirada', billing: true });
        if (!ents.features[feature]) {
          return res.status(403).json({ erro: 'Recurso indisponível no seu plano', upgrade: true });
        }
        next();
      })
      .catch(next);
  };
}

module.exports = { carregarEntitlements, requireAccess, requirePlan };
