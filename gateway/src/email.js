/**
 * Envio de e-mail por SMTP, sem dependências (node:net / node:tls).
 * Suporta TLS direto (porta 465), STARTTLS (587) e AUTH PLAIN/LOGIN. Só envia credenciais por conexão
 * criptografada (ou para localhost). Texto em UTF-8; anexos opcionais (PDF do DANFSe).
 */
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

const CRLF = '\r\n';
const semQuebra = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
const b64 = (buf) => Buffer.from(buf).toString('base64');
const b64Linhas = (buf) => b64(buf).replace(/(.{76})/g, `$1${CRLF}`);
const encCabecalho = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const endereco = (s) => /<([^>]+)>/.exec(s)?.[1] || semQuebra(s);
const ehLocal = (h) => ['localhost', '127.0.0.1', '::1'].includes(h);

/** Monta a mensagem MIME (texto em base64; anexos em multipart/mixed). */
export function montarMensagem({ de, para, assunto, texto, anexos = [], dominio = 'localhost' }) {
  const cab = [
    `From: ${semQuebra(de)}`,
    `To: ${semQuebra(para)}`,
    `Subject: ${encCabecalho(semQuebra(assunto))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${dominio}>`,
    'MIME-Version: 1.0',
  ];
  const corpoTexto = [`Content-Type: text/plain; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', b64Linhas(texto)].join(CRLF);
  if (!anexos.length) return [...cab, corpoTexto].join(CRLF) + CRLF;
  const lim = `=_nexo_${randomUUID()}`;
  const partes = [`--${lim}`, corpoTexto];
  for (const a of anexos) {
    partes.push(`--${lim}`, [
      `Content-Type: ${a.tipo || 'application/octet-stream'}; name="${semQuebra(a.nome).replace(/"/g, '')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${semQuebra(a.nome).replace(/"/g, '')}"`,
      '', b64Linhas(a.conteudo),
    ].join(CRLF));
  }
  partes.push(`--${lim}--`);
  return [...cab, `Content-Type: multipart/mixed; boundary="${lim}"`, '', partes.join(CRLF)].join(CRLF) + CRLF;
}

/** Uma conversa SMTP completa. Rejeita com Error se o servidor responder com erro ou demorar. */
async function conversar(cfg, { de, para, mensagem }) {
  const { host, port, secure, user, pass } = cfg;
  const rejeitar = cfg.rejeitarCertificadoInvalido !== false;
  let socket;
  let buffer = '';
  const fila = [];
  let esperando = null;
  let falha = null;

  const ligar = (s) => {
    socket = s;
    s.setEncoding('utf8');
    s.on('data', (d) => { buffer += d; processar(); });
    s.on('error', (e) => { falha = e; if (esperando) { const r = esperando; esperando = null; r.rej(e); } });
    s.on('close', () => { if (!falha) falha = new Error('Conexão SMTP encerrada'); if (esperando) { const r = esperando; esperando = null; r.rej(falha); } });
  };
  const processar = () => {
    // Resposta = linhas "NNN-..." terminadas por "NNN ...".
    for (;;) {
      const linhas = buffer.split(CRLF);
      if (linhas.length < 2) return;
      let fim = -1;
      for (let i = 0; i < linhas.length - 1; i++) if (/^\d{3} /.test(linhas[i]) || /^\d{3}$/.test(linhas[i])) { fim = i; break; }
      if (fim < 0) return;
      const bloco = linhas.slice(0, fim + 1);
      buffer = linhas.slice(fim + 1).join(CRLF);
      const resposta = { codigo: Number(bloco[fim].slice(0, 3)), linhas: bloco };
      if (esperando) { const r = esperando; esperando = null; r.res(resposta); } else fila.push(resposta);
    }
  };
  const ler = () => new Promise((res, rej) => {
    if (fila.length) return res(fila.shift());
    if (falha) return rej(falha);
    esperando = { res, rej };
  });
  const enviar = (linha) => socket.write(linha + CRLF);
  const esperar = async (...codigos) => {
    const r = await ler();
    if (!codigos.includes(r.codigo)) throw new Error(`SMTP ${r.linhas[r.linhas.length - 1]}`);
    return r;
  };
  const comando = async (linha, ...codigos) => { enviar(linha); return esperar(...codigos); };

  const conectar = () => new Promise((res, rej) => {
    const opts = { host, port, servername: ehLocal(host) ? undefined : host, rejectUnauthorized: rejeitar };
    const s = secure ? tls.connect(opts) : net.connect({ host, port });
    s.once('error', rej);
    s.once(secure ? 'secureConnect' : 'connect', () => { s.removeListener('error', rej); res(s); });
  });

  try {
    ligar(await conectar());
    let cifrado = !!secure;
    await esperar(220);
    const nome = 'nexo-fiscal.local';
    let ehlo = await comando(`EHLO ${nome}`, 250);
    if (!cifrado && ehlo.linhas.some((l) => /STARTTLS/i.test(l)) && cfg.starttls !== false) {
      await comando('STARTTLS', 220);
      socket.removeAllListeners('data'); socket.removeAllListeners('error'); socket.removeAllListeners('close');
      buffer = ''; fila.length = 0;
      const s2 = await new Promise((res, rej) => {
        const t = tls.connect({ socket, servername: ehLocal(host) ? undefined : host, rejectUnauthorized: rejeitar }, () => res(t));
        t.once('error', rej);
      });
      ligar(s2);
      cifrado = true;
      ehlo = await comando(`EHLO ${nome}`, 250);
    }
    if (user) {
      if (!cifrado && !ehLocal(host)) throw new Error('O servidor SMTP não oferece conexão criptografada; as credenciais não foram enviadas');
      const anuncia = ehlo.linhas.join(' ');
      if (/AUTH[^\r\n]*PLAIN/i.test(anuncia) || !/AUTH/i.test(anuncia)) await comando(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`, 235);
      else { await comando('AUTH LOGIN', 334); await comando(b64(user), 334); await comando(b64(pass), 235); }
    }
    await comando(`MAIL FROM:<${endereco(de)}>`, 250);
    await comando(`RCPT TO:<${endereco(para)}>`, 250, 251);
    await comando('DATA', 354);
    const corpo = mensagem.replace(/\r?\n/g, CRLF).replace(/^\./gm, '..');
    socket.write(corpo + (corpo.endsWith(CRLF) ? '' : CRLF) + '.' + CRLF);
    await esperar(250);
    try { enviar('QUIT'); } catch { /* já encerrou */ }
  } finally {
    socket?.destroy();
  }
}

/** Cria o remetente a partir da configuração. `ativo` é falso sem SMTP_HOST. */
export function criarEmail(config, log = console.error) {
  const c = config.smtp || {};
  const ativo = !!c.host;
  async function enviar({ para, assunto, texto, anexos }) {
    if (!ativo) return false;
    const mensagem = montarMensagem({ de: c.from, para, assunto, texto, anexos, dominio: endereco(c.from).split('@')[1] || 'localhost' });
    let tempo;
    const limite = new Promise((_, rej) => { tempo = setTimeout(() => rej(new Error('Tempo esgotado falando com o servidor SMTP')), c.timeoutMs || 20000); });
    try {
      await Promise.race([conversar(c, { de: c.from, para, mensagem }), limite]);
      return true;
    } finally { clearTimeout(tempo); }
  }
  /** Envia sem derrubar quem chamou: falhas só vão para o log. */
  const enviarSemFalhar = (dados) => enviar(dados).catch((e) => { log(`Falha ao enviar e-mail (${dados.assunto}):`, e.message); return false; });
  return { ativo, enviar, enviarSemFalhar };
}
