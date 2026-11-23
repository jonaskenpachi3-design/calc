import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Número decimal opcional: variável ausente, vazia ou inválida usa o padrão (no Docker, variável não definida chega vazia).
const num = (valor, padrao) => {
  const n = Number(valor);
  return valor === undefined || valor === '' || !Number.isFinite(n) || n < 0 ? padrao : n;
};

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
    emailsPorDia: int(env.EMAILS_POR_DIA, 100), // DANFSe enviados por e-mail, por conta
    appName: env.APP_NAME || 'Nexo Fiscal',
    // E-mail por SMTP (opcional). Sem SMTP_HOST, os links só vão para o webhook ou para o operador.
    smtp: {
      host: env.SMTP_HOST || '',
      port: int(env.SMTP_PORT, env.SMTP_SECURE === 'true' ? 465 : 587),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.SMTP_FROM || (env.SMTP_USER ? `${env.APP_NAME || 'Nexo Fiscal'} <${env.SMTP_USER}>` : `${env.APP_NAME || 'Nexo Fiscal'} <nao-responda@localhost>`),
      timeoutMs: int(env.SMTP_TIMEOUT_MS, 20000),
    },
    // Cobrança (Asaas). Sem ASAAS_API_KEY, a cobrança fica desligada e os planos são trocados pelo operador.
    asaas: {
      apiKey: env.ASAAS_API_KEY || '',
      // Chaves de teste começam com $aact_hmlg_; ASAAS_URL permite apontar para outro endereço (testes).
      url: (env.ASAAS_URL || ((env.ASAAS_API_KEY || '').startsWith('$aact_hmlg_') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3')).replace(/\/$/, ''),
      webhookToken: env.ASAAS_WEBHOOK_TOKEN || '',
      timeoutMs: int(env.ASAAS_TIMEOUT_MS, 15000),
    },
    // Preços mensais (R$) dos planos. Valores provisórios: ajuste por variável de ambiente.
    precos: {
      gratuito: 0,
      profissional: num(env.PRECO_PROFISSIONAL, 149),
      ilimitado: num(env.PRECO_ILIMITADO, 399),
    },
    // Dias de tolerância depois do vencimento do período pago antes de voltar ao plano gratuito.
    carenciaDias: num(env.CARENCIA_DIAS, 5),
    resetTtlSeconds: int(env.RESET_TTL_SECONDS, 3600),
    confirmTtlSeconds: int(env.CONFIRM_TTL_SECONDS, 86400),
    // Se 'true', contas novas só usam o sistema depois de confirmar o e-mail. Padrão: só mostra um aviso.
    exigirConfirmacaoEmail: env.EXIGIR_CONFIRMACAO_EMAIL === 'true',
    upstream: {
      regimeRegular: env.UPSTREAM_REGIME_REGULAR || 'http://regime-regular:8080',
      simplesNacional: env.UPSTREAM_SIMPLES_NACIONAL || 'http://simples-nacional:8082',
      danfse: env.UPSTREAM_DANFSE || 'http://danfse:8080',
      timeoutMs: int(env.UPSTREAM_TIMEOUT_MS, 30000),
    },
    // Alíquotas nominais de referência (%) exigidas pela calculadora a partir de 2027.
    aliquotasReferencia: {
      cbs: num(env.ALIQUOTA_CBS, 8.8),
      ibsEstadual: num(env.ALIQUOTA_IBS_ESTADUAL, 0.05),
      ibsMunicipal: num(env.ALIQUOTA_IBS_MUNICIPAL, 0.05),
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
