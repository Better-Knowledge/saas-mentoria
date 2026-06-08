// seed.js — popula a PRIMEIRA organização com dados de mockup realistas.
// Uso: node seed.js  (apaga os clientes/interações daquela org e recria)
require('dotenv').config();
const { pool, withOrg } = require('./db');

const clientes = [
  { nome: 'Mariana Albuquerque', empresa: 'Grupo Vega Varejo', cargo: 'Diretora de Inovação',
    telefone: '(11) 98877-1020', email: 'mariana@grupovega.com.br',
    tipo_cliente: 'b2b', origem: 'Indicação', etapa: 'proposta', resultado: 'em_aberto',
    valor_estimado: 48000, proposta_enviada: 1, status_pagamento: 'Aguardando aprovação',
    proxima_acao: 'Ligar para fechar a proposta', proxima_acao_data: '2026-05-28', created_by: 'humano',
    interacoes: [
      { texto: 'Reunião de diagnóstico: querem um agente que responda dúvidas de produto no WhatsApp do varejo.', dias: '2026-05-20' },
      { texto: 'Proposta enviada por e-mail: projeto de 8 semanas, R$ 48k.', dias: '2026-05-26' },
    ] },
  { nome: 'Dr. Henrique Sales', empresa: 'Sales Advocacia', cargo: 'Sócio',
    telefone: '(21) 99654-7788', email: 'henrique@salesadv.com.br',
    tipo_cliente: 'autonomo', origem: 'LinkedIn', etapa: 'reuniao', resultado: 'em_aberto',
    valor_estimado: 15000, proposta_enviada: 0, status_pagamento: null,
    proxima_acao: 'Enviar resumo da call + escopo', proxima_acao_data: '2026-05-31', created_by: 'humano',
    interacoes: [{ texto: 'Quer automatizar a triagem de petições com IA. Marcou call de diagnóstico.', dias: '2026-05-29' }] },
  { nome: 'Secretaria Municipal de Educação', empresa: 'Prefeitura de Campina Nova', cargo: 'Gabinete',
    telefone: '(35) 3521-4000', email: 'gabinete@campinanova.sp.gov.br',
    tipo_cliente: 'publico', origem: 'Palestra', etapa: 'qualificacao', resultado: 'em_aberto',
    valor_estimado: 90000, proposta_enviada: 0, status_pagamento: null,
    proxima_acao: 'Confirmar verba e processo de contratação', proxima_acao_data: '2026-06-05', created_by: 'humano',
    interacoes: [{ texto: 'Após a palestra, pediram um projeto de capacitação de professores em IA generativa.', dias: '2026-05-22' }] },
  { nome: 'Camila Ferraz', empresa: 'Ateliê Ferraz', cargo: 'Fundadora',
    telefone: '(48) 99123-4567', email: 'camila@atelieferraz.com',
    tipo_cliente: 'autonomo', origem: 'Instagram', etapa: 'novo', resultado: 'em_aberto',
    valor_estimado: 2500, proposta_enviada: 0, status_pagamento: null,
    proxima_acao: 'Responder no WhatsApp e qualificar', proxima_acao_data: '2026-05-30', created_by: 'ia',
    interacoes: [{ texto: 'Lead chegou pelo Instagram perguntando sobre a mentoria de IA para pequenos negócios.', dias: '2026-05-30', ia: 1 }] },
  { nome: 'Rafael Tonin', empresa: 'Tonin Logística', cargo: 'CEO',
    telefone: '(41) 98800-2211', email: 'rafael@toninlog.com.br',
    tipo_cliente: 'b2b', origem: 'Indicação', etapa: 'proposta', resultado: 'ganho',
    valor_estimado: 62000, proposta_enviada: 1, status_pagamento: 'Pago (entrada 50%)',
    proxima_acao: 'Kickoff do projeto', proxima_acao_data: '2026-06-02', created_by: 'humano',
    interacoes: [{ texto: 'Fechamos! Projeto de automação de cotação de fretes com IA.', dias: '2026-05-27' }] },
  { nome: 'Beatriz Lemos', empresa: 'Clínica Viver', cargo: 'Gestora',
    telefone: '(31) 99777-3344', email: 'bia@clinicaviver.com.br',
    tipo_cliente: 'b2b', origem: 'YouTube', etapa: 'qualificacao', resultado: 'em_aberto',
    valor_estimado: 18000, proposta_enviada: 0, status_pagamento: null,
    proxima_acao: 'Enviar cases de saúde', proxima_acao_data: '2026-06-03', created_by: 'humano',
    interacoes: [{ texto: 'Assistiu um vídeo e quer um assistente de agendamento. Orçamento ainda indefinido.', dias: '2026-05-25' }] },
  { nome: 'João Pedro Marques', empresa: 'Startup Nuve', cargo: 'CTO',
    telefone: '(51) 98123-9090', email: 'jp@nuve.io',
    tipo_cliente: 'b2b', origem: 'Evento', etapa: 'reuniao', resultado: 'em_aberto',
    valor_estimado: 35000, proposta_enviada: 0, status_pagamento: null,
    proxima_acao: 'Reunião técnica de arquitetura', proxima_acao_data: '2026-06-08', created_by: 'humano',
    interacoes: [{ texto: 'Conheci no evento de IA. Querem integrar agentes ao produto SaaS deles.', dias: '2026-05-24' }] },
  { nome: 'Fernanda Dias', empresa: 'Dias Contabilidade', cargo: 'Sócia',
    telefone: '(62) 99456-1212', email: 'fernanda@diascontabil.com.br',
    tipo_cliente: 'autonomo', origem: 'Indicação', etapa: 'novo', resultado: 'em_aberto',
    valor_estimado: 4000, proposta_enviada: 0, status_pagamento: null,
    proxima_acao: 'Primeiro contato', proxima_acao_data: '2026-06-04', created_by: 'humano', interacoes: [] },
  { nome: 'Instituto Aurora', empresa: 'ONG Instituto Aurora', cargo: 'Coordenação',
    telefone: '(85) 3033-7700', email: 'contato@institutoaurora.org',
    tipo_cliente: 'publico', origem: 'LinkedIn', etapa: 'qualificacao', resultado: 'perdido',
    valor_estimado: 12000, proposta_enviada: 1, status_pagamento: null,
    proxima_acao: null, proxima_acao_data: null, created_by: 'humano',
    interacoes: [{ texto: 'Sem verba neste ciclo. Retomar contato no próximo semestre.', dias: '2026-05-18' }] },
  { nome: 'Lucas Bittencourt', empresa: 'Bittencourt Imóveis', cargo: 'Diretor',
    telefone: '(47) 99888-5566', email: 'lucas@bittencourtimoveis.com.br',
    tipo_cliente: 'b2b', origem: 'WhatsApp', etapa: 'proposta', resultado: 'em_aberto',
    valor_estimado: 27000, proposta_enviada: 1, status_pagamento: 'Aguardando',
    proxima_acao: 'Follow-up da proposta', proxima_acao_data: '2026-05-31', created_by: 'ia',
    interacoes: [
      { texto: 'Lead do WhatsApp: quer um agente para qualificar interessados em imóveis.', dias: '2026-05-23', ia: 1 },
      { texto: 'Proposta enviada: agente de qualificação + integração com o CRM atual.', dias: '2026-05-29' },
    ] },
];

(async () => {
  const { rows } = await pool.query('SELECT id, nome FROM organizations ORDER BY created_at ASC LIMIT 1');
  const org = rows[0];
  if (!org) { console.error('Nenhuma organização. Suba o servidor uma vez (bootstrap) ou faça signup antes.'); process.exit(1); }
  console.log('Semeando na organização:', org.nome);

  await withOrg(org.id, async (client) => {
    await client.query('DELETE FROM interacoes');
    await client.query('DELETE FROM clientes');
    for (const c of clientes) {
      const { interacoes = [], ...d } = c;
      const cli = (await client.query(`
        INSERT INTO clientes (org_id, nome, empresa, cargo, telefone, email, tipo_cliente, origem, etapa,
          resultado, valor_estimado, proposta_enviada, status_pagamento, proxima_acao, proxima_acao_data, created_by)
        VALUES (current_setting('app.current_org')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING id`,
        [d.nome, d.empresa, d.cargo, d.telefone, d.email, d.tipo_cliente, d.origem, d.etapa, d.resultado,
         d.valor_estimado, !!d.proposta_enviada, d.status_pagamento, d.proxima_acao, d.proxima_acao_data, d.created_by]
      )).rows[0];
      for (const i of interacoes) {
        await client.query(`
          INSERT INTO interacoes (org_id, cliente_id, texto, gerado_por_ia, data)
          VALUES (current_setting('app.current_org')::uuid, $1, $2, $3, $4)`,
          [cli.id, i.texto, !!i.ia, i.dias]);
      }
    }
  });

  const n = (await withOrg(org.id, (c) => c.query('SELECT COUNT(*)::int AS n FROM clientes'))).rows[0].n;
  console.log(`OK! ${n} clientes inseridos na organização "${org.nome}".`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
