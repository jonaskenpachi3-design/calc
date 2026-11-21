import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  hashSenha, conferirSenha, emitirToken, verificarToken, gerarChaveApi, sha256, compararSegredos,
} from './auth.js';
import { PLANOS, limiteDoPlano, inicioDoMes } from './plans.js';
import { chamar, CacheTtl } from './upstream.js';

const TIPOS_ESTATICOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

async function lerCorpo(req, limite) {
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > limite) throw new HttpError(413, 'corpo_grande_demais', `Corpo acima de ${limite} bytes`);
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

async function lerJson(req, limite) {
  const buf = await lerCorpo(req, limite);
  if (buf.length === 0) throw new HttpError(400, 'corpo_vazio', 'Corpo JSON obrigatório');
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'json_invalido', 'JSON inválido');
  }
}

function responder(res, status, dados, headers = {}) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(corpo),
    ...headers,
  });
  res.end(corpo);
}

const emailValido = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function criarApp(config, db) {
  const cache = new CacheTtl();
  const janelas = new Map(); // tenantId -> { minuto, contagem }
  const up = config.upstream;

  if (config.authSecret.length < 32) {
    throw new Error('AUTH_SECRET deve ter ao menos 32 caracteres');
  }

  // ---------- autenticação ----------
  function autenticar(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) throw new HttpError(401, 'nao_autenticado', 'Envie Authorization: Bearer <token ou chave de API>');
    const credencial = m[1].trim();

    if (credencial.startsWith('rtc_')) {
      const chave = db.chavePorHash(sha256(credencial));
      if (!chave || chave.revogada_em) throw new HttpError(401, 'chave_invalida', 'Chave de API inválida ou revogada');
      db.tocarChave(chave.id);
      return { tenantId: chave.tenant_id, via: 'chave' };
    }
    const claims = verificarToken(credencial, config.authSecret);
    if (!claims) throw new HttpError(401, 'token_invalido', 'Sessão inválida ou expirada');
    return { tenantId: claims.tid, userId: claims.uid, via: 'sessao' };
  }

  function limitarTaxa(tenantId) {
    const minuto = Math.floor(Date.now() / 60000);
    const j = janelas.get(tenantId);
    if (!j || j.minuto !== minuto) {
      janelas.set(tenantId, { minuto, contagem: 1 });
      return;
    }
    if (++j.contagem > config.rateLimitPorMinuto) {
      throw new HttpError(429, 'limite_de_taxa', 'Muitas requisições por minuto');
    }
  }

  function verificarCota(tenantId, recurso) {
    const tenant = db.tenantPorId(tenantId);
    if (!tenant) throw new HttpError(401, 'tenant_inexistente', 'Conta não encontrada');
    const limite = limiteDoPlano(tenant.plano, recurso);
    if (limite === null) return;
    const usado = db.contarUso(tenantId, recurso, inicioDoMes());
    if (usado >= limite) {
      throw new HttpError(402, 'cota_esgotada', `Cota mensal de ${recurso} esgotada no plano ${tenant.plano} (${limite})`);
    }
  }

  // Executa uma chamada ao serviço oficial, cobra a cota e registra o evento.
  async function proxy({ ctx, recurso, servico, url, method = 'POST', headers, body, operacaoId, payloadJson }) {
    verificarCota(ctx.tenantId, recurso);
    const t0 = Date.now();
    const r = await chamar(url, { method, headers, body, timeoutMs: up.timeoutMs });
    const duracaoMs = Date.now() - t0;
    if (!r.ok) {
      throw new HttpError(
        r.motivo === 'timeout' ? 504 : 502,
        'servico_indisponivel',
        `Serviço ${servico} ${r.motivo === 'timeout' ? 'excedeu o tempo limite' : 'indisponível'}`,
      );
    }
    db.registrarUso({
      tenantId: ctx.tenantId, recurso, servico, status: r.status, duracaoMs, operacaoId,
      payload: config.guardarPayloads && payloadJson ? JSON.stringify(payloadJson) : null,
    });
    return r;
  }

  const enviar = (res, r) => {
    res.writeHead(r.status, { ...r.headers, 'content-length': r.body.length });
    res.end(r.body);
  };

  const JSON_H = { 'content-type': 'application/json', accept: 'application/json' };

  async function calcular(ctx, regime, modo, operacao) {
    if (typeof operacao !== 'object' || operacao === null || Array.isArray(operacao)) {
      throw new HttpError(400, 'operacao_invalida', 'Envie a operação como objeto JSON');
    }
    const mapa = {
      'regular': [up.regimeRegular, '/api/calculadora/observabilidade/regime-geral', 'regime-regular'],
      'regular-simples': null,
      'simples': [up.simplesNacional, '/api/calculadora/observabilidade/simples-nacional/nao-assistido', 'simples-nacional'],
      'simples-informado': [up.simplesNacional, '/api/calculadora/observabilidade/simples-nacional', 'simples-nacional'],
    };
    const alvo = mapa[modo ?? regime];
    if (!alvo) throw new HttpError(400, 'regime_invalido', 'regime deve ser "regular" ou "simples"');
    const [base, rota, servico] = alvo;
    return proxy({
      ctx, recurso: 'calculo', servico, url: base + rota, headers: JSON_H,
      body: JSON.stringify(operacao), operacaoId: operacao.id ?? null, payloadJson: operacao,
    });
  }

  // ---------- rotas ----------
  async function rotear(req, res, url) {
    const { pathname } = url;
    const metodo = req.method;

    if (pathname === '/health') return responder(res, 200, { status: 'ok' });

    // --- contas ---
    if (metodo === 'POST' && pathname === '/auth/register') {
      const { nome, email, senha } = await lerJson(req, 10_000);
      if (typeof nome !== 'string' || !nome.trim() || nome.length > 120) throw new HttpError(400, 'nome_invalido', 'Nome obrigatório');
      if (!emailValido(email)) throw new HttpError(400, 'email_invalido', 'E-mail inválido');
      if (typeof senha !== 'string' || senha.length < 10 || senha.length > 200) {
        throw new HttpError(400, 'senha_fraca', 'A senha deve ter de 10 a 200 caracteres');
      }
      const emailNorm = email.trim().toLowerCase();
      if (db.usuarioPorEmail(emailNorm)) throw new HttpError(409, 'email_em_uso', 'E-mail já cadastrado');
      const { tenantId, userId } = db.criarTenantComUsuario({
        nome: nome.trim(), email: emailNorm, senhaHash: await hashSenha(senha),
      });
      const token = emitirToken({ tid: tenantId, uid: userId }, config.authSecret, config.sessionTtlSeconds);
      return responder(res, 201, { token, plano: 'gratuito' });
    }

    if (metodo === 'POST' && pathname === '/auth/login') {
      const { email, senha } = await lerJson(req, 10_000);
      const user = typeof email === 'string' ? db.usuarioPorEmail(email.trim().toLowerCase()) : undefined;
      // Sempre faz o hash, para não revelar por tempo se o e-mail existe.
      const ok = await conferirSenha(String(senha ?? ''), user?.senha_hash ?? 'scrypt$AAAA$AAAA');
      if (!user || !ok) throw new HttpError(401, 'credenciais_invalidas', 'E-mail ou senha incorretos');
      const token = emitirToken({ tid: user.tenant_id, uid: user.id }, config.authSecret, config.sessionTtlSeconds);
      return responder(res, 200, { token });
    }

    // --- administração (operador do SaaS) ---
    const mAdmin = /^\/admin\/tenants\/([\w-]+)\/plano$/.exec(pathname);
    if (metodo === 'PUT' && mAdmin) {
      const enviado = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!config.adminToken || !compararSegredos(enviado, config.adminToken)) {
        throw new HttpError(403, 'proibido', 'Token de administração inválido');
      }
      const { plano } = await lerJson(req, 1_000);
      if (!PLANOS[plano]) throw new HttpError(400, 'plano_invalido', `Planos: ${Object.keys(PLANOS).join(', ')}`);
      if (!db.definirPlano(mAdmin[1], plano)) throw new HttpError(404, 'nao_encontrado', 'Conta não encontrada');
      return responder(res, 200, { plano });
    }

    // --- a partir daqui, tudo exige credencial ---
    if (!pathname.startsWith('/v1/') && !/^\/(me|keys|usage|history)/.test(pathname)) {
      throw new HttpError(404, 'nao_encontrado', 'Rota inexistente');
    }
    const ctx = autenticar(req);
    limitarTaxa(ctx.tenantId);

    if (metodo === 'GET' && pathname === '/me') {
      const t = db.tenantPorId(ctx.tenantId);
      return responder(res, 200, { id: t.id, nome: t.nome, plano: t.plano });
    }

    if (metodo === 'GET' && pathname === '/usage') {
      const t = db.tenantPorId(ctx.tenantId);
      const desde = inicioDoMes();
      const uso = {};
      for (const recurso of ['calculo', 'danfse']) {
        uso[recurso] = { usado: db.contarUso(ctx.tenantId, recurso, desde), limite: limiteDoPlano(t.plano, recurso) };
      }
      return responder(res, 200, { plano: t.plano, desde, uso });
    }

    if (metodo === 'GET' && pathname === '/history') {
      const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 50, 1), 200);
      return responder(res, 200, { eventos: db.historico(ctx.tenantId, limite) });
    }

    if (pathname === '/keys') {
      if (ctx.via !== 'sessao') throw new HttpError(403, 'proibido', 'Gerencie chaves com login, não com chave de API');
      if (metodo === 'GET') return responder(res, 200, { chaves: db.listarChaves(ctx.tenantId) });
      if (metodo === 'POST') {
        const { nome } = await lerJson(req, 1_000);
        if (typeof nome !== 'string' || !nome.trim() || nome.length > 80) throw new HttpError(400, 'nome_invalido', 'Nome da chave obrigatório');
        const { chave, prefixo, hash } = gerarChaveApi();
        const id = db.criarChave({ tenantId: ctx.tenantId, nome: nome.trim(), prefixo, hash });
        // A chave completa só aparece aqui, uma vez.
        return responder(res, 201, { id, chave, aviso: 'Guarde a chave agora: ela não será exibida novamente.' });
      }
    }
    const mChave = /^\/keys\/([\w-]+)$/.exec(pathname);
    if (metodo === 'DELETE' && mChave) {
      if (ctx.via !== 'sessao') throw new HttpError(403, 'proibido', 'Gerencie chaves com login, não com chave de API');
      if (!db.revogarChave(ctx.tenantId, mChave[1])) throw new HttpError(404, 'nao_encontrado', 'Chave não encontrada ou já revogada');
      return responder(res, 200, { revogada: true });
    }

    // --- API fiscal unificada ---
    if (metodo === 'POST' && pathname === '/v1/calculo') {
      const { regime, operacao } = await lerJson(req, config.maxJsonBytes);
      return enviar(res, await calcular(ctx, regime, undefined, operacao));
    }
    if (metodo === 'POST' && pathname === '/v1/regime-regular/calculo') {
      return enviar(res, await calcular(ctx, 'regular', 'regular', await lerJson(req, config.maxJsonBytes)));
    }
    if (metodo === 'POST' && pathname === '/v1/simples-nacional/calculo') {
      return enviar(res, await calcular(ctx, 'simples', 'simples', await lerJson(req, config.maxJsonBytes)));
    }
    if (metodo === 'POST' && pathname === '/v1/simples-nacional/calculo-informado') {
      return enviar(res, await calcular(ctx, 'simples', 'simples-informado', await lerJson(req, config.maxJsonBytes)));
    }

    if (metodo === 'POST' && pathname === '/v1/danfse') {
      const xml = await lerCorpo(req, config.maxXmlBytes);
      if (xml.length === 0) throw new HttpError(400, 'corpo_vazio', 'Envie o XML da NFS-e no corpo (Content-Type: application/xml)');
      const qs = new URLSearchParams();
      const stc = url.searchParams.get('stc');
      const canhoto = url.searchParams.get('canhoto');
      if (stc !== null) {
        if (!['0', '1', '2'].includes(stc)) throw new HttpError(400, 'stc_invalido', 'stc deve ser 0, 1 ou 2');
        qs.set('stc', stc);
      }
      if (canhoto !== null) {
        if (!['true', 'false'].includes(canhoto)) throw new HttpError(400, 'canhoto_invalido', 'canhoto deve ser true ou false');
        qs.set('canhoto', canhoto);
      }
      const sufixo = qs.size ? `?${qs}` : '';
      // O XML nunca é gravado no histórico.
      return enviar(res, await proxy({
        ctx, recurso: 'danfse', servico: 'danfse', url: `${up.danfse}/api/danfse${sufixo}`,
        headers: { 'content-type': 'application/xml' }, body: xml,
      }));
    }

    if (metodo === 'GET' && pathname === '/v1/simples-nacional/atividades') {
      return enviar(res, await consultar('simples-nacional', `${up.simplesNacional}/api/calculadora/simples-nacional/atividades${url.search}`));
    }
    const mAtiv = /^\/v1\/simples-nacional\/atividades\/(\d{1,3})$/.exec(pathname);
    if (metodo === 'GET' && mAtiv) {
      return enviar(res, await consultar('simples-nacional', `${up.simplesNacional}/api/calculadora/simples-nacional/atividades/${mAtiv[1]}${url.search}`));
    }

    // Tabelas oficiais do regime regular (lista fechada: o gateway não vira proxy aberto).
    const mTab = /^\/v1\/tabelas\/(situacoes-tributarias\/cbs-ibs|classificacoes-tributarias\/[\w-]+(?:\/[\w-]+)?|fundamentacoes-legais|ncm|nbs|aliquota-uniao|aliquota-uf|aliquota-municipio)$/.exec(pathname);
    if (metodo === 'GET' && mTab) {
      return enviar(res, await consultar('regime-regular', `${up.regimeRegular}/api/calculadora/dados-abertos/${mTab[1]}${url.search}`));
    }

    if (metodo === 'GET' && pathname === '/v1/versao') {
      const [a, b, c] = await Promise.all([
        chamar(`${up.regimeRegular}/api/versao`, { timeoutMs: 5000 }),
        chamar(`${up.simplesNacional}/api/versao`, { timeoutMs: 5000 }),
        chamar(`${up.danfse}/health/ready`, { timeoutMs: 5000 }),
      ]);
      const corpo = (r) => { try { return JSON.parse(r.body.toString('utf8')); } catch { return null; } };
      return responder(res, 200, {
        regimeRegular: a.ok ? { status: a.status, ...corpo(a) } : { status: 'indisponivel' },
        simplesNacional: b.ok ? { status: b.status, ...corpo(b) } : { status: 'indisponivel' },
        danfse: c.ok ? { status: c.status === 200 ? 'ok' : 'indisponivel' } : { status: 'indisponivel' },
      });
    }

    throw new HttpError(404, 'nao_encontrado', 'Rota inexistente');
  }

  // Consultas somente-leitura: cache curto, não consomem cota.
  async function consultar(servico, urlCompleta) {
    const hit = cache.get(urlCompleta);
    if (hit) return hit;
    const r = await chamar(urlCompleta, { headers: { accept: 'application/json' }, timeoutMs: up.timeoutMs });
    if (!r.ok) throw new HttpError(502, 'servico_indisponivel', `Serviço ${servico} indisponível`);
    if (r.status === 200) cache.set(urlCompleta, r);
    return r;
  }

  // ---------- arquivos estáticos (interface web) ----------
  function servirEstatico(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const arquivo = path.resolve(config.publicDir, rel);
    if (!arquivo.startsWith(path.resolve(config.publicDir) + path.sep) || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
      return false;
    }
    const tipo = TIPOS_ESTATICOS[path.extname(arquivo)];
    if (!tipo) return false;
    const dados = fs.readFileSync(arquivo);
    res.writeHead(200, { 'content-type': tipo, 'content-length': dados.length, 'cache-control': 'no-cache' });
    res.end(dados);
    return true;
  }

  return http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://gateway');
      if (req.method === 'GET' && !url.pathname.startsWith('/v1/') && servirEstatico(res, url.pathname)) return;
      await rotear(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return responder(res, e.status, { erro: { codigo: e.codigo, mensagem: e.message } });
      console.error(JSON.stringify({ nivel: 'error', evento: 'erro_interno', mensagem: String(e?.message ?? e) }));
      responder(res, 500, { erro: { codigo: 'erro_interno', mensagem: 'Erro interno' } });
    }
  });
}
