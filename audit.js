/*
 * Mini CRM — Consultoria & IA Generativa
 * Copyright (c) 2026 Fernando Melo Faraco <fernando.faraco@better-knowledge.com.br>
 * Comunidade Profissionais do Futuro (CPDF) · Better Knowledge
 *
 * Licenciado sob a licença MIT. O texto completo está em LICENSE, na raiz do projeto.
 * SPDX-License-Identifier: MIT
 */
// audit.js — trilha de auditoria de alterações (PRD RF-84 / RF-85).
//
// Duas regras que sustentam o valor desta tabela, e que este módulo faz cumprir:
//
//   1. O autor NUNCA vem do cliente. Este módulo só aceita um `principal` — o objeto
//      produzido pela autenticação — e deriva dele autor e credencial. Não existe
//      parâmetro `autor` que alguém possa preencher à mão.
//   2. A trilha NÃO guarda dado pessoal. Ela precisa sobreviver à exclusão do cliente
//      (apagar o dado é direito do titular; apagar a prova de que ele foi apagado, não).
//      Se ela guardasse o telefone antigo, a exclusão seria fictícia.
const db = require('./db');

// Campos cujo VALOR jamais entra na trilha — só o nome do campo é registrado.
// Conteúdo de reunião e dado de contato ficam fora por definição (FR-022).
const CAMPOS_SEM_VALOR = new Set([
  'texto', 'transcricao', 'transcricao_texto', 'resumo', 'payload',
  'telefone', 'email', 'senha', 'senha_hash',
]);

const LIMITE_VALOR = 200; // um valor de campo, não um documento

// Reduz um valor a algo seguro e útil de guardar.
function valorSeguro(campo, valor) {
  if (valor === undefined || valor === null) return null;
  if (CAMPOS_SEM_VALOR.has(campo)) return '[omitido]';
  const s = String(valor);
  return s.length > LIMITE_VALOR ? `${s.slice(0, LIMITE_VALOR)}…` : s;
}

// Grava uma linha da trilha. `principal` é o objeto da autenticação:
//   { tipo: 'humano'|'ia', credencial: 'sessao'|'apikey', id }
function registrar({ entidade, entidade_id, acao, campo = null, valor_anterior = null,
                     valor_novo = null, principal }) {
  if (!principal || !principal.credencial) {
    // Falha fechada: sem credencial verificada não há autoria confiável, e uma
    // trilha com autoria inventada é pior que trilha nenhuma.
    throw new Error('auditoria exige um principal autenticado');
  }
  db.prepare(`
    INSERT INTO auditoria
      (entidade, entidade_id, acao, campo, valor_anterior, valor_novo, autor, credencial, credencial_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entidade, Number(entidade_id), acao, campo,
    valorSeguro(campo, valor_anterior), valorSeguro(campo, valor_novo),
    principal.tipo === 'ia' ? 'ia' : 'humano',
    principal.credencial,
    principal.id ?? null,
  );
}

// Leitura para inspeção e testes. A aplicação não expõe edição nem exclusão (RF-85).
function listar({ entidade, entidade_id } = {}) {
  if (entidade && entidade_id !== undefined) {
    return db.prepare(
      'SELECT * FROM auditoria WHERE entidade = ? AND entidade_id = ? ORDER BY id'
    ).all(entidade, Number(entidade_id));
  }
  return db.prepare('SELECT * FROM auditoria ORDER BY id').all();
}

module.exports = { registrar, listar, CAMPOS_SEM_VALOR };
