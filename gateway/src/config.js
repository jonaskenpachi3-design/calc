import { fileURLToPath } from 'node:url';
import path from 'node:path';

const int = (valor, padrao) => {
  const n = Number.parseInt(valor ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    dbPath: env.DB_PATH || './data/saas.db',
    authSecret: env.AUTH_SECRET || '',
    adminToken: env.ADMIN_TOKEN || '',
    sessionTtlSeconds: int(env.SESSION_TTL_SECONDS, 8 * 3600),
    // Recuperação de senha: o link é entregue por webhook (serviço de e-mail/automação seu) ou gerado pelo operador.
    publicUrl: (env.PUBLIC_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/$/, ''),
    resetWebhookUrl: env.RESET_WEBHOOK_URL || '',
    resetWebhookToken: env.RESET_WEBHOOK_TOKEN || '',
    resetTtlSeconds: int(env.RESET_TTL_SECONDS, 3600),
    upstream: {
      regimeRegular: env.UPSTREAM_REGIME_REGULAR || 'http://regime-regular:8080',
      simplesNacional: env.UPSTREAM_SIMPLES_NACIONAL || 'http://simples-nacional:8082',
      danfse: env.UPSTREAM_DANFSE || 'http://danfse:8080',
      timeoutMs: int(env.UPSTREAM_TIMEOUT_MS, 30000),
    },
    // Alíquotas nominais de referência (%) exigidas pela calculadora a partir de 2027.
    aliquotasReferencia: {
      cbs: Number(env.ALIQUOTA_CBS ?? 8.8),
      ibsEstadual: Number(env.ALIQUOTA_IBS_ESTADUAL ?? 0.05),
      ibsMunicipal: Number(env.ALIQUOTA_IBS_MUNICIPAL ?? 0.05),
    },
    maxJsonBytes: int(env.MAX_JSON_BYTES, 2 * 1024 * 1024),
    maxOperacoesLote: int(env.MAX_OPERACOES_LOTE, 200),
    maxXmlBytes: int(env.MAX_XML_BYTES, 5 * 1024 * 1024),
    rateLimitPorMinuto: int(env.RATE_LIMIT_PER_MINUTE, 120),
    // Dados fiscais são sensíveis: por padrão só metadados vão para o histórico.
    guardarPayloads: env.STORE_PAYLOADS === 'true',
    publicDir:
      env.PUBLIC_DIR ||
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public'),
  };
}
