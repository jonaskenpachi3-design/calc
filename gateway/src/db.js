import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { novoId } from './auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  plano TEXT NOT NULL DEFAULT 'gratuito',
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  nome TEXT NOT NULL,
  prefixo TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL,
  revogada_em TEXT,
  ultimo_uso_em TEXT
);
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  recurso TEXT NOT NULL,
  servico TEXT NOT NULL,
  status INTEGER NOT NULL,
  duracao_ms INTEGER NOT NULL,
  operacao_id TEXT,
  payload TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_recurso_data
  ON usage_events (tenant_id, recurso, criado_em);
`;

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(caminho)), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return criarRepositorio(db);
}

const agora = () => new Date().toISOString();

function criarRepositorio(db) {
  const q = {
    inserirTenant: db.prepare('INSERT INTO tenants (id, nome, plano, criado_em) VALUES (?, ?, ?, ?)'),
    inserirUser: db.prepare(
      'INSERT INTO users (id, tenant_id, email, senha_hash, criado_em) VALUES (?, ?, ?, ?, ?)',
    ),
    userPorEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    tenantPorId: db.prepare('SELECT * FROM tenants WHERE id = ?'),
    atualizarPlano: db.prepare('UPDATE tenants SET plano = ? WHERE id = ?'),
    inserirChave: db.prepare(
      'INSERT INTO api_keys (id, tenant_id, nome, prefixo, hash, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    chavePorHash: db.prepare('SELECT * FROM api_keys WHERE hash = ?'),
    tocarChave: db.prepare('UPDATE api_keys SET ultimo_uso_em = ? WHERE id = ?'),
    listarChaves: db.prepare(
      'SELECT id, nome, prefixo, criado_em, revogada_em, ultimo_uso_em FROM api_keys WHERE tenant_id = ? ORDER BY criado_em DESC',
    ),
    revogarChave: db.prepare(
      'UPDATE api_keys SET revogada_em = ? WHERE id = ? AND tenant_id = ? AND revogada_em IS NULL',
    ),
    inserirUso: db.prepare(
      `INSERT INTO usage_events (tenant_id, recurso, servico, status, duracao_ms, operacao_id, payload, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    contarUso: db.prepare(
      'SELECT COUNT(*) AS total FROM usage_events WHERE tenant_id = ? AND recurso = ? AND criado_em >= ?',
    ),
    historico: db.prepare(
      `SELECT id, recurso, servico, status, duracao_ms AS duracaoMs, operacao_id AS operacaoId,
              payload, criado_em AS criadoEm
         FROM usage_events WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
    ),
  };

  return {
    raw: db,
    close: () => db.close(),

    criarTenantComUsuario({ nome, email, senhaHash }) {
      const tenantId = novoId();
      const userId = novoId();
      const t = agora();
      db.exec('BEGIN');
      try {
        q.inserirTenant.run(tenantId, nome, 'gratuito', t);
        q.inserirUser.run(userId, tenantId, email, senhaHash, t);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return { tenantId, userId };
    },
    usuarioPorEmail: (email) => q.userPorEmail.get(email),
    tenantPorId: (id) => q.tenantPorId.get(id),
    definirPlano: (tenantId, plano) => q.atualizarPlano.run(plano, tenantId).changes > 0,

    criarChave({ tenantId, nome, prefixo, hash }) {
      const id = novoId();
      q.inserirChave.run(id, tenantId, nome, prefixo, hash, agora());
      return id;
    },
    chavePorHash: (hash) => q.chavePorHash.get(hash),
    tocarChave: (id) => q.tocarChave.run(agora(), id),
    listarChaves: (tenantId) => q.listarChaves.all(tenantId),
    revogarChave: (tenantId, id) => q.revogarChave.run(agora(), id, tenantId).changes > 0,

    registrarUso({ tenantId, recurso, servico, status, duracaoMs, operacaoId = null, payload = null }) {
      q.inserirUso.run(tenantId, recurso, servico, status, duracaoMs, operacaoId, payload, agora());
    },
    contarUso: (tenantId, recurso, desdeIso) => Number(q.contarUso.get(tenantId, recurso, desdeIso).total),
    historico: (tenantId, limite) => q.historico.all(tenantId, limite),
  };
}
