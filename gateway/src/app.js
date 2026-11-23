import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  hashSenha, conferirSenha, emitirToken, verificarToken, gerarChaveApi, sha256, compararSegredos, tokenAleatorio,
} from './auth.js';
import { PLANOS, limiteDoPlano, inicioDoMes } from './plans.js';
import { chamar, CacheTtl } from './upstream.js';
import {
  montarRegimeNormal, traduzirRegimeNormal, montarSimples, traduzirSimples,
  mensagemDeErroOficial, EntradaInvalida,
} from './simulacao.js';

// Validar CNPJ (básico)
function cnpjValido(cnpj) {
  const c = String(cnpj).replace(/\D/g, '');
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  // Validação dos dígitos verificadores
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += parseInt(c[i]) * (i < 4 ? 5 - i : 13 - i);
  let dig1 = 11 - (soma % 11);
  if (dig1 >= 10) dig1 = 0;
  soma = 0;
  for (let i = 0; i < 13; i++) soma += parseInt(c[i]) * (i < 5 ? 6 - i : 14 - i);
  let dig2 = 11 - (soma % 11);
  if (dig2 >= 10) dig2 = 0;
  return parseInt(c[12]) === dig1 && parseInt(c[13]) === dig2;
}

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
    // Sessões emitidas antes da última troca de senha deixam de valer.
    const dono = db.usuarioPorId(claims.uid);
    if (!dono || (claims.iat || 0) < dono.senha_alterada_em) throw new HttpError(401, 'token_invalido', 'Sessão inválida ou expirada');
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

  // Simulação guiada: recebe o formulário, chama a calculadora oficial e devolve um resultado legível.
  async function simular(ctx, tipo, entrada) {
    let operacao;
    try {
      operacao = tipo === 'regime-normal'
        ? montarRegimeNormal(entrada, config.aliquotasReferencia)
        : montarSimples(entrada);
    } catch (e) {
      if (e instanceof EntradaInvalida) throw new HttpError(400, 'entrada_invalida', e.message);
      throw e;
    }
    const alvo = tipo === 'regime-normal'
      ? [up.regimeRegular, '/api/calculadora/observabilidade/regime-geral', 'regime-regular']
      : [up.simplesNacional, '/api/calculadora/observabilidade/simples-nacional/nao-assistido', 'simples-nacional'];
    const r = await proxy({
      ctx, recurso: 'calculo', servico: alvo[2], url: alvo[0] + alvo[1], headers: JSON_H,
      body: JSON.stringify(operacao), operacaoId: operacao.id, payloadJson: entrada,
    });
    if (r.status !== 200) {
      const motivo = mensagemDeErroOficial(r.body);
      throw new HttpError(r.status >= 500 ? 502 : 422, 'calculo_recusado',
        motivo || 'A calculadora não aceitou os dados informados. Revise o formulário.');
    }
    let corpo;
    try { corpo = JSON.parse(r.body.toString('utf8')); } catch {
      throw new HttpError(502, 'resposta_invalida', 'Resposta inesperada da calculadora');
    }
    const simulado = !!r.headers['x-warning-dados-simulados'];
    return tipo === 'regime-normal' ? traduzirRegimeNormal(corpo, entrada, simulado) : traduzirSimples(corpo, entrada);
  }

  // ---------- rotas ----------
  async function rotear(req, res, url) {
    const { pathname } = url;
    const metodo = req.method;

    if (pathname === '/health') return responder(res, 200, { status: 'ok' });

    // --- contas ---
    if (metodo === 'GET' && pathname === '/planos') return responder(res, 200, { planos: PLANOS });

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

    // --- recuperação de senha ---
    const linkDeRedefinicao = (userId) => {
      const token = tokenAleatorio();
      const expira = db.criarRedefinicao(userId, sha256(token), config.resetTtlSeconds);
      return { link: `${config.publicUrl}/#/redefinir?token=${token}`, expira_em: new Date(expira).toISOString() };
    };

    if (metodo === 'POST' && pathname === '/auth/esqueci') {
      const { email } = await lerJson(req, 2_000);
      const resposta = { mensagem: 'Se este e-mail tiver cadastro, enviaremos as instruções para criar uma nova senha.' };
      if (!emailValido(email)) return responder(res, 202, resposta);
      const user = db.usuarioPorEmail(email.trim().toLowerCase());
      // No máximo 3 pedidos por hora por conta; a resposta é a mesma existindo ou não o e-mail.
      if (user && db.redefinicoesRecentes(user.id, Date.now() - 3600_000) < 3) {
        const { link, expira_em: expiraEm } = linkDeRedefinicao(user.id);
        if (config.resetWebhookUrl) {
          fetch(config.resetWebhookUrl, {
            method: 'POST', signal: AbortSignal.timeout(5000),
            headers: { 'content-type': 'application/json', ...(config.resetWebhookToken ? { authorization: `Bearer ${config.resetWebhookToken}` } : {}) },
            body: JSON.stringify({ tipo: 'redefinicao_de_senha', email: user.email, link, expira_em: expiraEm }),
          }).catch((e) => console.error('Falha ao entregar a redefinição de senha:', e.message));
        }
      }
      return responder(res, 202, resposta);
    }

    if (metodo === 'POST' && pathname === '/auth/redefinir') {
      const { token, senha } = await lerJson(req, 2_000);
      if (typeof senha !== 'string' || senha.length < 10 || senha.length > 200) throw new HttpError(400, 'senha_fraca', 'A senha deve ter de 10 a 200 caracteres');
      const userId = typeof token === 'string' && token.length >= 20 && token.length <= 100 ? db.gastarRedefinicao(sha256(token)) : null;
      if (!userId) throw new HttpError(400, 'link_invalido', 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".');
      db.redefinirSenha(userId, await hashSenha(senha));
      return responder(res, 200, { mensagem: 'Senha alterada. Entre com a nova senha.' });
    }

    // Recuperação assistida: o operador gera o link e passa ao cliente por um canal confiável.
    if (metodo === 'POST' && pathname === '/admin/usuarios/redefinicao') {
      const enviado = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!config.adminToken || !compararSegredos(enviado, config.adminToken)) throw new HttpError(403, 'proibido', 'Token de administração inválido');
      const { email } = await lerJson(req, 2_000);
      const user = typeof email === 'string' ? db.usuarioPorEmail(email.trim().toLowerCase()) : null;
      if (!user) throw new HttpError(404, 'nao_encontrado', 'Usuário não encontrado');
      return responder(res, 200, linkDeRedefinicao(user.id));
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
    if (!pathname.startsWith('/v1/') && !/^\/(me|keys|usage|history|empresas)/.test(pathname)) {
      throw new HttpError(404, 'nao_encontrado', 'Rota inexistente');
    }
    const ctx = autenticar(req);
    limitarTaxa(ctx.tenantId);

    if (metodo === 'GET' && pathname === '/me') {
      const t = db.tenantPorId(ctx.tenantId);
      return responder(res, 200, { id: t.id, nome: t.nome, plano: t.plano });
    }

    // --- Empresas (Multi-CNPJ) ---
    if (metodo === 'GET' && pathname === '/empresas') {
      const empresas = db.listarEmpresas(ctx.tenantId);
      return responder(res, 200, { empresas });
    }

    if (metodo === 'POST' && pathname === '/empresas') {
      const { cnpj, razao_social, nome_fantasia, regime_atual, cnae_principal, endereco } = await lerJson(req, 10_000);
      const limpo = String(cnpj ?? '').replace(/\D/g, '');
      if (!cnpjValido(limpo)) throw new HttpError(400, 'cnpj_invalido', 'CNPJ inválido');
      if (!razao_social || typeof razao_social !== 'string' || !razao_social.trim()) throw new HttpError(400, 'razao_obrigatoria', 'Razão Social é obrigatória');
      if (!regime_atual || !['simples-nacional', 'lucro-presumido', 'lucro-real'].includes(regime_atual)) {
        throw new HttpError(400, 'regime_invalido', 'Regime deve ser: simples-nacional, lucro-presumido ou lucro-real');
      }
      const limiteEmpresas = limiteDoPlano(db.tenantPorId(ctx.tenantId).plano, 'empresas');
      if (limiteEmpresas !== null && db.contarEmpresas(ctx.tenantId) >= limiteEmpresas) {
        throw new HttpError(403, 'limite_empresas', `Seu plano permite até ${limiteEmpresas} CNPJs. Fale conosco para ampliar o limite.`);
      }
      try {
        const nova = db.criarEmpresa({
          tenantId: ctx.tenantId,
          cnpj: limpo,
          razao_social: razao_social.trim(),
          nome_fantasia: nome_fantasia?.trim() || null,
          regime_atual,
          cnae_principal: cnae_principal?.trim() || null,
          endereco_json: endereco ? JSON.stringify(endereco) : null,
        });
        return responder(res, 201, nova);
      } catch (e) {
        if (e.message.includes('já cadastrado')) throw new HttpError(409, 'cnpj_duplicado', e.message);
        throw e;
      }
    }

    if (metodo === 'POST' && pathname === '/empresas/delete') {
      const { cnpj } = await lerJson(req, 1_000);
      const limpo = String(cnpj ?? '').replace(/\D/g, '');
      if (!cnpjValido(limpo)) throw new HttpError(400, 'cnpj_invalido', 'CNPJ inválido');
      if (!db.deletarEmpresa(ctx.tenantId, limpo)) throw new HttpError(404, 'empresa_nao_encontrada', 'Empresa não encontrada');
      return responder(res, 200, { deletada: true });
    }

    if (metodo === 'GET' && pathname === '/empresas/ativa') {
      // Retorna a empresa ativa baseada no header X-Empresa-Ativa
      const empresaAtiva = req.headers['x-empresa-ativa'];
      if (!empresaAtiva) throw new HttpError(400, 'empresa_nao_selecionada', 'Envie header X-Empresa-Ativa com o CNPJ');
      const emp = db.obterEmpresa(ctx.tenantId, empresaAtiva);
      if (!emp) throw new HttpError(404, 'empresa_nao_encontrada', 'Empresa não encontrada para este contador');
      return responder(res, 200, emp);
    }

    // --- Análises salvas por empresa (só totais) e dashboard ---
    const mAnalises = /^\/empresas\/(\d{14})\/analises$/.exec(pathname);
    if (metodo === 'POST' && mAnalises) {
      const cnpj = mAnalises[1];
      if (!db.obterEmpresa(ctx.tenantId, cnpj)) throw new HttpError(404, 'empresa_nao_encontrada', 'Empresa não encontrada');
      const b = await lerJson(req, 5_000);
      const num = (v, nome, opcional = false) => {
        if (opcional && (v === null || v === undefined)) return null;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e13) throw new HttpError(400, 'analise_invalida', `Valor inválido em ${nome}`);
        return Math.round(v * 100) / 100;
      };
      const inteiro = (v, nome) => { if (!Number.isInteger(v) || v < 0 || v > 1e7) throw new HttpError(400, 'analise_invalida', `Valor inválido em ${nome}`); return v; };
      if (!['simulacao', 'lote'].includes(b.origem)) throw new HttpError(400, 'analise_invalida', 'origem deve ser simulacao ou lote');
      if (!['regime-normal', 'simples-nacional'].includes(b.regime)) throw new HttpError(400, 'analise_invalida', 'regime inválido');
      const id = db.registrarAnalise(ctx.tenantId, cnpj, {
        origem: b.origem, regime: b.regime,
        documentos: inteiro(b.documentos, 'documentos'), itens: inteiro(b.itens, 'itens'), itens_com_problema: inteiro(b.itensComProblema, 'itensComProblema'),
        base: num(b.base, 'base'), cbs: num(b.cbs, 'cbs'), ibs: num(b.ibs, 'ibs'), imposto_seletivo: num(b.impostoSeletivo ?? 0, 'impostoSeletivo'), total: num(b.total, 'total'),
        tributos_atuais: num(b.tributosAtuais, 'tributosAtuais', true), cbs_ibs_comparavel: num(b.cbsIbsComparavel, 'cbsIbsComparavel', true),
      });
      return responder(res, 201, { salva: true, id });
    }

    const mApagar = /^\/empresas\/(\d{14})\/analises\/(\d+)$/.exec(pathname);
    if (metodo === 'DELETE' && mApagar) {
      if (!db.removerAnalise(ctx.tenantId, mApagar[1], Number(mApagar[2]))) throw new HttpError(404, 'analise_nao_encontrada', 'Análise não encontrada');
      return responder(res, 200, { removida: true });
    }

    const mDashboard = /^\/empresas\/(\d{14})\/dashboard$/.exec(pathname);
    if (metodo === 'GET' && mDashboard) {
      const cnpj = mDashboard[1];
      if (!db.obterEmpresa(ctx.tenantId, cnpj)) throw new HttpError(404, 'empresa_nao_encontrada', 'Empresa não encontrada');
      const agora = new Date();
      const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 5, 1));
      const analises = db.analisesDesde(ctx.tenantId, cnpj, inicio.toISOString());
      const soma = (lista, campo) => Math.round(lista.reduce((a, x) => a + (x[campo] || 0), 0) * 100) / 100;
      const comparaveis = analises.filter((x) => x.tributos_atuais !== null && x.cbs_ibs_comparavel !== null);
      const base = soma(analises, 'base'); const cbsIbs = soma(analises, 'cbs') + soma(analises, 'ibs');
      const atual = soma(comparaveis, 'tributos_atuais'); const novo = soma(comparaveis, 'cbs_ibs_comparavel');
      const baseComp = comparaveis.length ? soma(comparaveis.map((x) => ({ b: x.base })), 'b') : 0;
      const pct = (v, b) => (b > 0 ? Math.round((v / b) * 10000) / 100 : null);
      const meses = []; const rotulos = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      for (let i = 0; i < 6; i++) { const d = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + i, 1)); meses.push({ chave: d.toISOString().slice(0, 7), rotulo: rotulos[d.getUTCMonth()] }); }
      const porMes = (filtro, valor) => meses.map((m) => Math.round(analises.filter((x) => x.criado_em.slice(0, 7) === m.chave && filtro(x)).reduce((a, x) => a + valor(x), 0) * 100) / 100);
      const comProblema = analises.reduce((a, x) => a + x.itens_com_problema, 0);
      const ultima = analises[0];
      const t = db.tenantPorId(ctx.tenantId);
      const desde = inicioDoMes();
      return responder(res, 200, {
        periodo: { desde: inicio.toISOString().slice(0, 10), meses: meses.length },
        vazio: analises.length === 0,
        analises: analises.length,
        faturamentoAnalisado: { valor: base, qtdNotas: analises.reduce((a, x) => a + x.documentos, 0) },
        cargaAtual: { valor: atual, percentual: pct(atual, baseComp), analises: comparaveis.length },
        projecaoReforma: { valor: Math.round(cbsIbs * 100) / 100, percentual: pct(cbsIbs, base) },
        diferenca: { valor: comparaveis.length ? Math.round((novo - atual) * 100) / 100 : null, tipo: novo >= atual ? 'aumento' : 'reducao', comparavel: comparaveis.length > 0 },
        alertas: comProblema > 0 ? [{ tipo: 'itens_com_problema', qtd: comProblema, mensagem: `${comProblema} item(ns) das análises do período tiveram problema na calculadora. Abra a Auditoria para corrigir.` }] : [],
        grafico: { labels: meses.map((m) => m.rotulo), series: [
          { nome: 'Tributos atuais (informados)', cor: '#5f7084', valores: porMes((x) => x.tributos_atuais !== null, (x) => x.tributos_atuais) },
          { nome: 'CBS + IBS (regime normal)', cor: '#3976bd', valores: porMes((x) => x.regime === 'regime-normal', (x) => x.cbs + x.ibs) },
          { nome: 'CBS + IBS (Simples Nacional)', cor: '#0d9488', valores: porMes((x) => x.regime === 'simples-nacional', (x) => x.cbs + x.ibs) },
        ] },
        ultimaAnalise: ultima ? { em: ultima.criado_em, origem: ultima.origem, regime: ultima.regime, documentos: ultima.documentos } : null,
        uso: {
          calculo: { usado: db.contarUso(ctx.tenantId, 'calculo', desde), limite: limiteDoPlano(t.plano, 'calculo') },
          danfse: { usado: db.contarUso(ctx.tenantId, 'danfse', desde), limite: limiteDoPlano(t.plano, 'danfse') },
        },
      });
    }

    // --- Dados do escritório (saem nos relatórios) ---
    if (pathname === '/me/escritorio') {
      if (metodo === 'GET') return responder(res, 200, db.obterEscritorio(ctx.tenantId) || {});
      if (metodo === 'PUT') {
        if (ctx.via !== 'sessao') throw new HttpError(403, 'proibido', 'Altere os dados do escritório com login, não com chave de API');
        const b = await lerJson(req, 400_000);
        const texto = (v, max) => { if (v === undefined || v === null || v === '') return null; if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'dado_invalido', 'Texto inválido ou longo demais'); return v.trim(); };
        const cor = texto(b.cor, 7);
        if (cor && !/^#[0-9a-fA-F]{6}$/.test(cor)) throw new HttpError(400, 'dado_invalido', 'Cor inválida');
        const logo = texto(b.logo, 300_000);
        if (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new HttpError(400, 'dado_invalido', 'Logotipo deve ser PNG, JPG ou WebP');
        db.gravarEscritorio(ctx.tenantId, { nome: texto(b.nome, 80), responsavel: texto(b.responsavel, 80), crc: texto(b.crc, 30), contato: texto(b.contato, 120), cor, logo });
        return responder(res, 200, db.obterEscritorio(ctx.tenantId));
      }
    }

    if (metodo === 'GET' && pathname === '/usage') {
      const t = db.tenantPorId(ctx.tenantId);
      const desde = inicioDoMes();
      const uso = {};
      for (const recurso of ['calculo', 'danfse']) {
        uso[recurso] = { usado: db.contarUso(ctx.tenantId, recurso, desde), limite: limiteDoPlano(t.plano, recurso) };
      }
      uso.empresas = { usado: db.contarEmpresas(ctx.tenantId), limite: limiteDoPlano(t.plano, 'empresas') };
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

    const mSim = /^\/v1\/simulacoes\/(regime-normal|simples-nacional)$/.exec(pathname);
    if (metodo === 'POST' && mSim) {
      const entrada = await lerJson(req, config.maxJsonBytes);
      return responder(res, 200, await simular(ctx, mSim[1], entrada));
    }

    // Lote: várias simulações de uma vez. Cada operação gasta uma unidade da cota.
    if (metodo === 'POST' && pathname === '/v1/simulacoes/lote') {
      const { regime, operacoes } = await lerJson(req, config.maxJsonBytes);
      if (regime !== 'regime-normal' && regime !== 'simples-nacional') {
        throw new HttpError(400, 'regime_invalido', 'Escolha o regime: regime normal ou Simples Nacional');
      }
      if (!Array.isArray(operacoes) || operacoes.length === 0) {
        throw new HttpError(400, 'lote_vazio', 'Envie ao menos uma operação');
      }
      if (operacoes.length > config.maxOperacoesLote) {
        throw new HttpError(400, 'lote_grande', `Envie no máximo ${config.maxOperacoesLote} operações por vez`);
      }
      const resultados = new Array(operacoes.length);
      let proximo = 0;
      const trabalhador = async () => {
        while (proximo < operacoes.length) {
          const i = proximo++;
          try {
            resultados[i] = { indice: i, ok: true, resultado: await simular(ctx, regime, operacoes[i]) };
          } catch (e) {
            resultados[i] = { indice: i, ok: false, erro: e instanceof HttpError ? e.message : 'Não foi possível simular esta operação.' };
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, trabalhador));
      return responder(res, 200, { resultados });
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

    // Atividades do Simples (exige ?data=AAAA-MM-DD; aceita tpDoc, cClassTrib, anexos).
    if (metodo === 'GET' && pathname === '/v1/simples-nacional/atividades') {
      return enviar(res, await consultar('simples-nacional', `${up.simplesNacional}/api/calculadora/simples-nacional/atividades${url.search}`));
    }
    const mAtiv = /^\/v1\/simples-nacional\/atividades\/(\d{1,3})$/.exec(pathname);
    if (metodo === 'GET' && mAtiv) {
      return enviar(res, await consultar('simples-nacional', `${up.simplesNacional}/api/calculadora/simples-nacional/atividades/${mAtiv[1]}${url.search}`));
    }

    // Tabelas oficiais do regime regular (lista fechada: o gateway não vira proxy aberto).
    // A maioria exige ?data=AAAA-MM-DD.
    const mTab = /^\/v1\/(?:dados|tabelas)\/(ufs|ufs\/municipios|ncm|ncm\/vigentes|nbs|nbs\/lista|nbs-aplicaveis|classificacoes-tributarias\/(?:nbs|ncm-aplicavel|nbs-aplicavel)|situacoes-tributarias\/(?:cbs-ibs|is)|classificacoes-tributarias\/(?:cbs-ibs|imposto-seletivo)|aliquota-uniao|aliquota-uf|aliquota-municipio|fundamentacoes-legais)$/.exec(pathname);
    if (metodo === 'GET' && mTab) {
      return enviar(res, await consultar('regime-regular', `${up.regimeRegular}/api/calculadora/dados-abertos/${mTab[1]}${url.search}`));
    }

    if (metodo === 'GET' && pathname === '/v1/versao') {
      const [a, b, c] = await Promise.all([
        chamar(`${up.regimeRegular}/api/calculadora/dados-abertos/versao`, { timeoutMs: 5000 }),
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
