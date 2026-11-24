import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { criarEmail, montarMensagem } from '../src/email.js';
import { textoDoEmail } from '../src/email-textos.js';

// Certificado autoassinado só para os testes (precisa do openssl).
let credencial = null;
try {
  const d = mkdtempSync(path.join(tmpdir(), 'smtp-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${d}/k.pem`, '-out', `${d}/c.pem`, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  credencial = { key: readFileSync(`${d}/k.pem`), cert: readFileSync(`${d}/c.pem`) };
} catch { /* sem openssl: testes de TLS são pulados */ }

/** Servidor SMTP de mentira. modo: 'texto' | 'implicito' | 'starttls'. */
function servidorSmtp({ modo = 'texto', senha = 'segredo', recusarRcpt = false } = {}) {
  const recebidas = [];
  const atender = (socket0) => {
    let socket = socket0;
    let buf = ''; let emDados = false; let corpo = ''; const msg = { auth: null, de: null, para: [] };
    const dizer = (t) => socket.write(t + '\r\n');
    const dados = (d) => {
      buf += d;
      if (emDados) {
        const i = buf.indexOf('\r\n.\r\n');
        if (i < 0) return;
        corpo = buf.slice(0, i); buf = ''; emDados = false; msg.corpo = corpo; recebidas.push(msg); dizer('250 ok'); return;
      }
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const linha = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^EHLO/i.test(linha)) { dizer('250-localhost'); if (modo === 'starttls' && !(socket instanceof tls.TLSSocket)) dizer('250-STARTTLS'); dizer('250 AUTH PLAIN LOGIN'); }
        else if (/^STARTTLS/i.test(linha)) {
          dizer('220 pronto');
          const t = new tls.TLSSocket(socket, { isServer: true, ...credencial });
          t.setEncoding('utf8'); t.on('data', dados); t.on('error', () => {}); socket = t; buf = '';
        }
        else if (/^AUTH PLAIN/i.test(linha)) { const [, u, p] = Buffer.from(linha.split(' ')[2], 'base64').toString().split('\0'); msg.auth = [u, p]; if (p === senha) dizer('235 ok'); else dizer('535 credenciais invalidas'); }
        else if (/^MAIL FROM/i.test(linha)) { msg.de = /<(.*)>/.exec(linha)[1]; dizer('250 ok'); }
        else if (/^RCPT TO/i.test(linha)) { if (recusarRcpt) dizer('550 sem caixa'); else { msg.para.push(/<(.*)>/.exec(linha)[1]); dizer('250 ok'); } }
        else if (/^DATA/i.test(linha)) { dizer('354 va'); emDados = true; if (buf) { const resto = buf; buf = ''; dados(resto); } }
        else if (/^QUIT/i.test(linha)) { dizer('221 tchau'); socket.end(); }
      }
    };
    socket.setEncoding('utf8'); socket.on('data', dados); socket.on('error', () => {});
    dizer('220 fake smtp');
  };
  const srv = modo === 'implicito' ? tls.createServer({ ...credencial }, atender) : net.createServer(atender);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, porta: srv.address().port, recebidas })));
}

const decodificar = (corpo) => {
  const b = corpo.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  return Buffer.from(b.replace(/\r\n/g, ''), 'base64').toString('utf8');
};

test('SMTP em texto puro (localhost) com AUTH PLAIN, acentos e linha começando com ponto', async () => {
  const { srv, porta, recebidas } = await servidorSmtp();
  try {
    const email = criarEmail({ smtp: { host: '127.0.0.1', port: porta, user: 'u@x.com', pass: 'segredo', from: 'Nexo Fiscal <u@x.com>' } });
    assert.equal(email.ativo, true);
    await email.enviar({ para: 'cliente@y.com', assunto: 'Confirmação — olá', texto: 'Olá, João\n.linha com ponto\nfim' });
    assert.equal(recebidas.length, 1);
    assert.deepEqual(recebidas[0].auth, ['u@x.com', 'segredo']);
    assert.equal(recebidas[0].de, 'u@x.com');
    assert.deepEqual(recebidas[0].para, ['cliente@y.com']);
    assert.match(recebidas[0].corpo, /Subject: =\?UTF-8\?B\?/);
    assert.equal(decodificar(recebidas[0].corpo), 'Olá, João\n.linha com ponto\nfim');
  } finally { srv.close(); }
});

test('SMTP: senha errada e destinatário recusado viram erro; enviarSemFalhar não lança', async () => {
  const a = await servidorSmtp();
  try {
    const ruim = criarEmail({ smtp: { host: '127.0.0.1', port: a.porta, user: 'u', pass: 'errada', from: 'x <u@x.com>' } }, () => {});
    await assert.rejects(ruim.enviar({ para: 'c@y.com', assunto: 'a', texto: 'b' }), /535/);
    assert.equal(await ruim.enviarSemFalhar({ para: 'c@y.com', assunto: 'a', texto: 'b' }), false);
  } finally { a.srv.close(); }
  const b = await servidorSmtp({ recusarRcpt: true });
  try {
    const e = criarEmail({ smtp: { host: '127.0.0.1', port: b.porta, from: 'x <u@x.com>' } });
    await assert.rejects(e.enviar({ para: 'c@y.com', assunto: 'a', texto: 'b' }), /550/);
  } finally { b.srv.close(); }
});

test('SMTP sem host fica inativo e não envia', async () => {
  const e = criarEmail({ smtp: { host: '' } });
  assert.equal(e.ativo, false);
  assert.equal(await e.enviar({ para: 'a@b.com', assunto: 'x', texto: 'y' }), false);
});

test('SMTP com TLS direto e com STARTTLS', { skip: !credencial && 'openssl indisponível' }, async () => {
  for (const modo of ['implicito', 'starttls']) {
    const { srv, porta, recebidas } = await servidorSmtp({ modo });
    try {
      const email = criarEmail({ smtp: { host: '127.0.0.1', port: porta, secure: modo === 'implicito', user: 'u', pass: 'segredo', from: 'N <u@x.com>', rejeitarCertificadoInvalido: false } });
      await email.enviar({ para: 'c@y.com', assunto: modo, texto: 'corpo seguro' });
      assert.equal(recebidas.length, 1, modo);
      assert.equal(decodificar(recebidas[0].corpo), 'corpo seguro');
    } finally { srv.close(); }
  }
});

test('SMTP recusa mandar senha por conexão sem criptografia fora do localhost', async () => {
  const { srv, porta } = await servidorSmtp();
  try {
    // 127.0.0.2 não conta como localhost para a regra, mas chega ao mesmo servidor de teste.
    const e = criarEmail({ smtp: { host: '127.0.0.2', port: porta, user: 'u', pass: 'segredo', from: 'N <u@x.com>' } });
    await assert.rejects(e.enviar({ para: 'c@y.com', assunto: 'a', texto: 'b' }), /não oferece conexão criptografada|ECONN|EADDR/);
  } finally { srv.close(); }
});

test('mensagem com anexo e proteção contra injeção de cabeçalho', () => {
  const m = montarMensagem({ de: 'N <n@x.com>', para: 'a@b.com\r\nBcc: v@x.com', assunto: 'Oi\r\nBcc: v@x.com', texto: 'corpo', anexos: [{ nome: 'nota "1".pdf', tipo: 'application/pdf', conteudo: Buffer.from('%PDF-1.4') }] });
  assert.doesNotMatch(m, /\r\nBcc:/);
  assert.match(m, /multipart\/mixed/);
  assert.match(m, /filename="nota 1\.pdf"/);
  assert.match(m, new RegExp(Buffer.from('%PDF-1.4').toString('base64')));
});

test('textos em português para confirmação e redefinição', () => {
  const c = textoDoEmail({ tipo: 'confirmacao_de_email', link: 'https://x/#/confirmar-email?token=abc', expira_em: '2026-11-24T12:00:00Z' }, 'Nexo Fiscal');
  assert.match(c.assunto, /confirme seu e-mail/);
  assert.match(c.texto, /https:\/\/x\/#\/confirmar-email\?token=abc/);
  assert.match(textoDoEmail({ tipo: 'redefinicao_de_senha', link: 'L', expira_em: '2026-11-24T12:00:00Z' }).assunto, /nova senha/);
  assert.equal(textoDoEmail({ tipo: 'outro' }), null);
});

test('cadastro e "esqueci minha senha" mandam e-mail com o link (integração com o gateway)', async () => {
  const { loadConfig } = await import('../src/config.js');
  const { abrirBanco } = await import('../src/db.js');
  const { criarApp } = await import('../src/app.js');
  const http = await import('node:http');
  const { srv, porta, recebidas } = await servidorSmtp();
  const db = abrirBanco(':memory:');
  const gw = criarApp({
    ...loadConfig({ AUTH_SECRET: 'e'.repeat(40), PUBLIC_DIR: '/nonexistent', PUBLIC_URL: 'https://app.exemplo.com', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(porta), SMTP_USER: 'u@x.com', SMTP_PASS: 'segredo', APP_NAME: 'Nexo Teste' }),
  }, db);
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${gw.address().port}`;
  const post = (rota, corpo) => fetch(base + rota, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  const espera = async (n) => { for (let i = 0; i < 50 && recebidas.length < n; i++) await new Promise((r) => setTimeout(r, 40)); };
  try {
    assert.equal((await post('/auth/register', { nome: 'Z', email: 'novo@cliente.com', senha: 'senha-bem-longa' })).status, 201);
    await espera(1);
    assert.equal(recebidas.length, 1);
    assert.deepEqual(recebidas[0].para, ['novo@cliente.com']);
    assert.match(decodificar(recebidas[0].corpo), /https:\/\/app\.exemplo\.com\/#\/confirmar-email\?token=[\w-]{40,}/);
    assert.equal((await post('/auth/esqueci', { email: 'novo@cliente.com' })).status, 202);
    await espera(2);
    assert.match(decodificar(recebidas[1].corpo), /#\/redefinir\?token=/);
    // e-mail inexistente: nada é enviado
    await post('/auth/esqueci', { email: 'ninguem@cliente.com' });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(recebidas.length, 2);
  } finally { gw.close(); srv.close(); db.close(); }
});

test('DANFSe por e-mail: anexa o PDF, valida e respeita o limite diário', async () => {
  const { loadConfig } = await import('../src/config.js');
  const { abrirBanco } = await import('../src/db.js');
  const { criarApp } = await import('../src/app.js');
  const { srv, porta, recebidas } = await servidorSmtp();
  const db = abrirBanco(':memory:');
  const cfg = { AUTH_SECRET: 'e'.repeat(40), PUBLIC_DIR: '/nonexistent', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(porta), EMAILS_POR_DIA: '2', RATE_LIMIT_PER_MINUTE: '1000' };
  const gw = criarApp(loadConfig(cfg), db);
  const semSmtp = criarApp(loadConfig({ AUTH_SECRET: 'e'.repeat(40), PUBLIC_DIR: '/nonexistent' }), abrirBanco(':memory:'));
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
  await new Promise((r) => semSmtp.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${gw.address().port}`;
  const post = (b, rota, corpo, h = {}) => fetch(b + rota, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(corpo) });
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 'x')]).toString('base64');
  try {
    const t = (await (await post(base, '/auth/register', { nome: 'Silva Contábil', email: 'a@x.com', senha: 'senha-bem-longa' })).json()).token;
    const auth = { authorization: `Bearer ${t}` };
    await new Promise((r) => setTimeout(r, 150)); recebidas.length = 0; // e-mail de confirmação do cadastro
    assert.equal((await post(base, '/v1/danfse/email', { para: 'x', pdf }, auth)).status, 400);
    assert.equal((await post(base, '/v1/danfse/email', { para: 'c@y.com', pdf: Buffer.from('nao e pdf'.repeat(30)).toString('base64') }, auth)).status, 400);
    assert.equal((await post(base, '/v1/danfse/email', { para: 'c@y.com', pdf })).status, 401);
    const ok = await post(base, '/v1/danfse/email', { para: 'cliente@y.com', nome: 'NFS-e 123/2027.pdf', pdf, mensagem: 'Olá Maria, segue a nota.' }, auth);
    assert.equal(ok.status, 200);
    assert.equal(recebidas.length, 1);
    assert.deepEqual(recebidas[0].para, ['cliente@y.com']);
    assert.match(recebidas[0].corpo, /filename="NFS-e 1232027\.pdf"/);
    assert.match(recebidas[0].corpo, /application\/pdf/);
    assert.equal((await post(base, '/v1/danfse/email', { para: 'c@y.com', pdf }, auth)).status, 200);
    const limite = await post(base, '/v1/danfse/email', { para: 'c@y.com', pdf }, auth);
    assert.equal(limite.status, 429); // EMAILS_POR_DIA=2
    // sem SMTP configurado
    const t2 = (await (await post(`http://127.0.0.1:${semSmtp.address().port}`, '/auth/register', { nome: 'B', email: 'b@x.com', senha: 'senha-bem-longa' })).json()).token;
    assert.equal((await post(`http://127.0.0.1:${semSmtp.address().port}`, '/v1/danfse/email', { para: 'c@y.com', pdf }, { authorization: `Bearer ${t2}` })).status, 503);
  } finally { gw.close(); semSmtp.close(); srv.close(); db.close(); }
});
