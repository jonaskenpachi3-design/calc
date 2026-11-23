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
  criado_em TEXT NOT NULL,
  senha_alterada_em INTEGER NOT NULL DEFAULT 0,
  email_confirmado_em INTEGER
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

-- Tabela de empresas do contador (multi-CNPJ). A chave é (tenant_id, cnpj): dois escritórios podem ter o mesmo cliente.
CREATE TABLE IF NOT EXISTS empresas (
  cnpj TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT,
  regime_atual TEXT NOT NULL,
  cnae_principal TEXT,
  endereco_json TEXT,
  ultima_simulacao_at TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (tenant_id, cnpj)
);
CREATE INDEX IF NOT EXISTS idx_empresas_tenant ON empresas(tenant_id);
`;

// Só totais agregados de cada análise: nunca guardamos as notas nem os itens do cliente.
const SCHEMA_REDEFINICAO = `
CREATE TABLE IF NOT EXISTS redefinicoes_senha (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  criado_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  usado_em INTEGER
);
CREATE INDEX IF NOT EXISTS idx_redef_user ON redefinicoes_senha (user_id, criado_em);
CREATE TABLE IF NOT EXISTS confirmacoes_email (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  criado_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  usado_em INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conf_user ON confirmacoes_email (user_id, criado_em);
CREATE TABLE IF NOT EXISTS assinaturas (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  provedor TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  cpf_cnpj TEXT NOT NULL,
  assinatura_id TEXT NOT NULL,
  plano TEXT NOT NULL,
  status TEXT NOT NULL,
  valido_ate INTEGER NOT NULL DEFAULT 0,
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assin_prov ON assinaturas (assinatura_id);
CREATE TABLE IF NOT EXISTS eventos_cobranca (
  evento_id TEXT PRIMARY KEY,
  recebido_em INTEGER NOT NULL
);
`;

function migrarUsuarios(db) {
  const colunas = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (colunas.length && !colunas.includes('senha_alterada_em')) db.exec('ALTER TABLE users ADD COLUMN senha_alterada_em INTEGER NOT NULL DEFAULT 0');
  // Contas que já existiam antes da confirmação de e-mail ficam como confirmadas (ninguém é trancado para fora).
  if (colunas.length && !colunas.includes('email_confirmado_em')) {
    db.exec('ALTER TABLE users ADD COLUMN email_confirmado_em INTEGER');
    db.prepare('UPDATE users SET email_confirmado_em = ?').run(Date.now());
  }
}

const SCHEMA_ANALISES = `
CREATE TABLE IF NOT EXISTS analises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  origem TEXT NOT NULL,
  regime TEXT NOT NULL,
  documentos INTEGER NOT NULL,
  itens INTEGER NOT NULL,
  itens_com_problema INTEGER NOT NULL,
  base REAL NOT NULL,
  cbs REAL NOT NULL,
  ibs REAL NOT NULL,
  imposto_seletivo REAL NOT NULL,
  total REAL NOT NULL,
  tributos_atuais REAL,
  cbs_ibs_comparavel REAL,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analises_empresa ON analises (tenant_id, cnpj, criado_em);

-- Dados do escritório que saem nos relatórios.
CREATE TABLE IF NOT EXISTS escritorios (
  tenant_id TEXT PRIMARY KEY,
  nome TEXT,
  responsavel TEXT,
  crc TEXT,
  contato TEXT,
  cor TEXT,
  logo TEXT,
  atualizado_em TEXT NOT NULL
);
`;

// Bancos criados antes da chave composta: reconstrói a tabela sem perder as empresas.
function migrarEmpresas(db) {
  const colunas = db.prepare("PRAGMA table_info('empresas')").all();
  if (!colunas.length) return;
  const chaves = colunas.filter((c) => c.pk > 0).length;
  if (chaves !== 1) return;
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE empresas RENAME TO empresas_antiga');
    db.exec('DROP INDEX IF EXISTS idx_empresas_tenant');
    db.exec(SCHEMA.slice(SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS empresas'), SCHEMA.indexOf('CREATE INDEX IF NOT EXISTS idx_empresas_tenant')));
    db.exec('INSERT INTO empresas SELECT cnpj, tenant_id, razao_social, nome_fantasia, regime_atual, cnae_principal, endereco_json, ultima_simulacao_at, criado_em, atualizado_em FROM empresas_antiga');
    db.exec('DROP TABLE empresas_antiga');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(caminho)), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrarEmpresas(db);
  db.exec(SCHEMA);
  db.exec(SCHEMA_ANALISES);
  db.exec(SCHEMA_REDEFINICAO);
  migrarUsuarios(db);
  return criarRepositorio(db);
}

const agora = () => new Date().toISOString();

function criarRepositorio(db) {
  let carenciaMs = 5 * 86400000; // tolerância depois do vencimento do período pago (ajustada por definirCarenciaDias)
  const q = {
    inserirTenant: db.prepare('INSERT INTO tenants (id, nome, plano, criado_em) VALUES (?, ?, ?, ?)'),
    inserirUser: db.prepare(
      'INSERT INTO users (id, tenant_id, email, senha_hash, criado_em) VALUES (?, ?, ?, ?, ?)',
    ),
    userPorEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userPorId: db.prepare('SELECT * FROM users WHERE id = ?'),
    inserirRedef: db.prepare('INSERT INTO redefinicoes_senha (token_hash, user_id, criado_em, expira_em) VALUES (?, ?, ?, ?)'),
    contarRedef: db.prepare('SELECT COUNT(*) AS n FROM redefinicoes_senha WHERE user_id = ? AND criado_em >= ?'),
    consumirRedef: db.prepare('UPDATE redefinicoes_senha SET usado_em = ? WHERE token_hash = ? AND usado_em IS NULL AND expira_em > ?'),
    redefPorHash: db.prepare('SELECT * FROM redefinicoes_senha WHERE token_hash = ?'),
    invalidarRedefs: db.prepare('UPDATE redefinicoes_senha SET usado_em = ? WHERE user_id = ? AND usado_em IS NULL'),
    trocarSenha: db.prepare('UPDATE users SET senha_hash = ?, senha_alterada_em = ? WHERE id = ?'),
    inserirConf: db.prepare('INSERT INTO confirmacoes_email (token_hash, user_id, criado_em, expira_em) VALUES (?, ?, ?, ?)'),
    contarConf: db.prepare('SELECT COUNT(*) AS n FROM confirmacoes_email WHERE user_id = ? AND criado_em >= ?'),
    consumirConf: db.prepare('UPDATE confirmacoes_email SET usado_em = ? WHERE token_hash = ? AND usado_em IS NULL AND expira_em > ?'),
    confPorHash: db.prepare('SELECT * FROM confirmacoes_email WHERE token_hash = ?'),
    marcarConfirmado: db.prepare('UPDATE users SET email_confirmado_em = COALESCE(email_confirmado_em, ?) WHERE id = ?'),
    assinaturaDoTenant: db.prepare('SELECT * FROM assinaturas WHERE tenant_id = ?'),
    assinaturaPorId: db.prepare('SELECT * FROM assinaturas WHERE assinatura_id = ?'),
    gravarAssinatura: db.prepare(`INSERT INTO assinaturas (tenant_id, provedor, cliente_id, cpf_cnpj, assinatura_id, plano, status, valido_ate, criado_em, atualizado_em)
      VALUES (@tenant_id, @provedor, @cliente_id, @cpf_cnpj, @assinatura_id, @plano, @status, @valido_ate, @agora, @agora)
      ON CONFLICT(tenant_id) DO UPDATE SET provedor=@provedor, cliente_id=@cliente_id, cpf_cnpj=@cpf_cnpj, assinatura_id=@assinatura_id, plano=@plano, status=@status, valido_ate=@valido_ate, atualizado_em=@agora`),
    atualizarAssinatura: db.prepare('UPDATE assinaturas SET status = ?, valido_ate = ?, atualizado_em = ? WHERE tenant_id = ?'),
    inserirEvento: db.prepare('INSERT OR IGNORE INTO eventos_cobranca (evento_id, recebido_em) VALUES (?, ?)'),
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
    // Empresas (multi-CNPJ)
    inserirEmpresa: db.prepare(
      `INSERT INTO empresas (cnpj, tenant_id, razao_social, nome_fantasia, regime_atual, cnae_principal, endereco_json, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    atualizarEmpresa: db.prepare(
      `UPDATE empresas SET razao_social = ?, nome_fantasia = ?, regime_atual = ?, cnae_principal = ?, endereco_json = ?, atualizado_em = ? WHERE cnpj = ? AND tenant_id = ?`
    ),
    empresaPorCnpj: db.prepare('SELECT * FROM empresas WHERE cnpj = ? AND tenant_id = ?'),
    listarEmpresas: db.prepare('SELECT * FROM empresas WHERE tenant_id = ? ORDER BY atualizado_em DESC'),
    atualizarUltimaSimulacao: db.prepare('UPDATE empresas SET ultima_simulacao_at = ?, atualizado_em = ? WHERE cnpj = ? AND tenant_id = ?'),
    deletarEmpresa: db.prepare('DELETE FROM empresas WHERE cnpj = ? AND tenant_id = ?'),
    contarEmpresas: db.prepare('SELECT COUNT(*) AS n FROM empresas WHERE tenant_id = ?'),
    inserirAnalise: db.prepare(
      `INSERT INTO analises (tenant_id, cnpj, origem, regime, documentos, itens, itens_com_problema, base, cbs, ibs, imposto_seletivo, total, tributos_atuais, cbs_ibs_comparavel, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    analisesDesde: db.prepare('SELECT * FROM analises WHERE tenant_id = ? AND cnpj = ? AND criado_em >= ? ORDER BY criado_em DESC LIMIT 500'),
    apagarAnalises: db.prepare('DELETE FROM analises WHERE tenant_id = ? AND cnpj = ?'),
    apagarAnalise: db.prepare('DELETE FROM analises WHERE id = ? AND tenant_id = ? AND cnpj = ?'),
    escritorio: db.prepare('SELECT * FROM escritorios WHERE tenant_id = ?'),
    gravarEscritorio: db.prepare(
      `INSERT INTO escritorios (tenant_id, nome, responsavel, crc, contato, cor, logo, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET nome = excluded.nome, responsavel = excluded.responsavel, crc = excluded.crc, contato = excluded.contato, cor = excluded.cor, logo = excluded.logo, atualizado_em = excluded.atualizado_em`
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
    usuarioPorId: (id) => q.userPorId.get(id),
    criarRedefinicao: (userId, tokenHash, ttlSegundos) => { const t = Date.now(); q.inserirRedef.run(tokenHash, userId, t, t + ttlSegundos * 1000); return t + ttlSegundos * 1000; },
    redefinicoesRecentes: (userId, desdeMs) => q.contarRedef.get(userId, desdeMs).n,
    /** Gasta o token (uso único): devolve o id do usuário ou null se não existe, expirou ou já foi usado. */
    gastarRedefinicao: (tokenHash) => { const t = Date.now(); if (q.consumirRedef.run(t, tokenHash, t).changes !== 1) return null; return q.redefPorHash.get(tokenHash).user_id; },
    /** Troca a senha, derruba as sessões anteriores e invalida outros links pendentes. */
    // Quem recebeu e usou o link de senha no e-mail provou que ele é seu: conta como confirmado.
    redefinirSenha: (userId, senhaHash) => { const t = Date.now(); q.trocarSenha.run(senhaHash, t, userId); q.invalidarRedefs.run(t, userId); q.marcarConfirmado.run(t, userId); },
    criarConfirmacao: (userId, tokenHash, ttlSegundos) => { const t = Date.now(); q.inserirConf.run(tokenHash, userId, t, t + ttlSegundos * 1000); return t + ttlSegundos * 1000; },
    confirmacoesRecentes: (userId, desdeMs) => q.contarConf.get(userId, desdeMs).n,
    /** Gasta o link de confirmação (uso único) e marca o e-mail como confirmado. Devolve o id do usuário ou null. */
    gastarConfirmacao: (tokenHash) => {
      const t = Date.now();
      if (q.consumirConf.run(t, tokenHash, t).changes !== 1) return null;
      const userId = q.confPorHash.get(tokenHash).user_id;
      q.marcarConfirmado.run(t, userId);
      return userId;
    },
    confirmarEmail: (userId) => q.marcarConfirmado.run(Date.now(), userId),
    /**
     * Conta com plano efetivo: se há assinatura e o período pago (mais a carência) acabou, vale o plano gratuito.
     * Contas sem assinatura (plano definido pelo operador) não são afetadas.
     */
    tenantPorId: (id) => {
      const t = q.tenantPorId.get(id);
      if (!t) return t;
      const a = q.assinaturaDoTenant.get(id);
      if (a && t.plano !== 'gratuito' && Date.now() > a.valido_ate + carenciaMs) return { ...t, plano: 'gratuito', plano_contratado: t.plano, plano_vencido: true };
      return t;
    },
    definirCarenciaDias: (dias) => { carenciaMs = Math.max(0, dias) * 86400000; },
    assinaturaDoTenant: (id) => q.assinaturaDoTenant.get(id),
    assinaturaPorId: (assinaturaId) => q.assinaturaPorId.get(assinaturaId),
    gravarAssinatura: (a) => { q.gravarAssinatura.run({ valido_ate: 0, ...a, agora: Date.now() }); },
    atualizarAssinatura: (tenantId, status, validoAte) => { q.atualizarAssinatura.run(status, validoAte, Date.now(), tenantId); },
    /** Registra o evento do provedor; devolve false se já tinha sido processado (entrega repetida). */
    registrarEventoCobranca: (id) => q.inserirEvento.run(id, Date.now()).changes === 1,
    esquecerEventoCobranca: (id) => { db.prepare('DELETE FROM eventos_cobranca WHERE evento_id = ?').run(id); },
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

    // Empresas (multi-CNPJ)
    criarEmpresa({ tenantId, cnpj, razao_social, nome_fantasia, regime_atual, cnae_principal, endereco_json }) {
      const t = agora();
      const limpo = String(cnpj).replace(/\D/g, '');
      if (limpo.length !== 14) throw new Error('CNPJ deve ter 14 dígitos');
      if (q.empresaPorCnpj.get(limpo, tenantId)) throw new Error('CNPJ já cadastrado para este contador');
      q.inserirEmpresa.run(limpo, tenantId, razao_social, nome_fantasia || null, regime_atual, cnae_principal || null, endereco_json || null, t, t);
      return { cnpj: limpo, tenant_id: tenantId, razao_social, nome_fantasia, regime_atual, cnae_principal, endereco_json, criada_em: t, atualizada_em: t };
    },
    listarEmpresas: (tenantId) => q.listarEmpresas.all(tenantId),
    obterEmpresa: (tenantId, cnpj) => q.empresaPorCnpj.get(String(cnpj).replace(/\D/g, ''), tenantId),
    atualizarUltimaSimulacao: (tenantId, cnpj) => q.atualizarUltimaSimulacao.run(agora(), agora(), String(cnpj).replace(/\D/g, ''), tenantId),
    deletarEmpresa: (tenantId, cnpj) => {
      const limpo = String(cnpj).replace(/\D/g, '');
      q.apagarAnalises.run(tenantId, limpo);
      return q.deletarEmpresa.run(limpo, tenantId).changes > 0;
    },
    contarEmpresas: (tenantId) => q.contarEmpresas.get(tenantId).n,
    registrarAnalise(tenantId, cnpj, a) {
      const r = q.inserirAnalise.run(tenantId, cnpj, a.origem, a.regime, a.documentos, a.itens, a.itens_com_problema, a.base, a.cbs, a.ibs, a.imposto_seletivo, a.total, a.tributos_atuais, a.cbs_ibs_comparavel, agora());
      q.atualizarUltimaSimulacao.run(agora(), agora(), cnpj, tenantId);
      return Number(r.lastInsertRowid);
    },
    removerAnalise: (tenantId, cnpj, id) => q.apagarAnalise.run(id, tenantId, cnpj).changes > 0,
    analisesDesde: (tenantId, cnpj, desde) => q.analisesDesde.all(tenantId, cnpj, desde),
    obterEscritorio: (tenantId) => q.escritorio.get(tenantId) || null,
    gravarEscritorio: (tenantId, e) => q.gravarEscritorio.run(tenantId, e.nome, e.responsavel, e.crc, e.contato, e.cor, e.logo, agora()),
  };
}
