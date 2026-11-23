import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const b64 = (buf) => Buffer.from(buf).toString('base64url');

// ---------- senhas ----------

export async function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const derivada = await scrypt(senha, salt, 64);
  return `scrypt$${b64(salt)}$${b64(derivada)}`;
}

export async function conferirSenha(senha, armazenada) {
  const [esquema, salt, hash] = String(armazenada).split('$');
  if (esquema !== 'scrypt' || !salt || !hash) return false;
  const esperado = Buffer.from(hash, 'base64url');
  const obtido = await scrypt(senha, Buffer.from(salt, 'base64url'), esperado.length);
  return crypto.timingSafeEqual(esperado, obtido);
}

// ---------- tokens de sessão (HMAC-SHA256, formato payload.assinatura) ----------

function assinar(payloadB64, segredo) {
  return b64(crypto.createHmac('sha256', segredo).update(payloadB64).digest());
}

export function emitirToken(claims, segredo, ttlSegundos) {
  const exp = Math.floor(Date.now() / 1000) + ttlSegundos;
  const payload = b64(JSON.stringify({ ...claims, iat: Date.now(), exp }));
  return `${payload}.${assinar(payload, segredo)}`;
}

export function verificarToken(token, segredo) {
  if (typeof token !== 'string') return null;
  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return null;
  const esperada = Buffer.from(assinar(payload, segredo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---------- chaves de API ----------

export const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

export function gerarChaveApi() {
  const chave = `rtc_${crypto.randomBytes(24).toString('base64url')}`;
  return { chave, prefixo: chave.slice(0, 10), hash: sha256(chave) };
}

export function compararSegredos(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export const tokenAleatorio = () => crypto.randomBytes(32).toString('base64url');
export const novoId = () => crypto.randomUUID();
