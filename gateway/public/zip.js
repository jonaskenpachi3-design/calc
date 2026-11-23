/**
 * ZIP sem dependências: lê (armazenado e deflate) e escreve (só armazenado).
 * Leitura com limites para não aceitar "bomba de ZIP".
 */
const LIMITE_ARQUIVOS = 600;
const LIMITE_TOTAL = 60 * 1024 * 1024;

const TABELA = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function inflar(bytes, maximo) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const leitor = fluxo.getReader(); const partes = []; let total = 0;
  for (;;) {
    const { done, value } = await leitor.read(); if (done) break;
    total += value.length;
    if (total > maximo) { await leitor.cancel(); throw new Error('Arquivo descompactado grande demais.'); }
    partes.push(value);
  }
  const saida = new Uint8Array(total); let p = 0; for (const x of partes) { saida.set(x, p); p += x.length; }
  return saida;
}

/** Devolve [{ nome, bytes }] dos arquivos do ZIP (ignora pastas). */
export async function lerZip(buffer) {
  const b = new Uint8Array(buffer); const v = new DataView(buffer);
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('O arquivo não parece ser um ZIP válido.');
  const qtd = v.getUint16(fim + 10, true); let pos = v.getUint32(fim + 16, true);
  if (qtd > LIMITE_ARQUIVOS) throw new Error(`O ZIP tem mais de ${LIMITE_ARQUIVOS} arquivos. Envie em partes.`);
  const saida = []; let total = 0; const dec = new TextDecoder();
  for (let k = 0; k < qtd; k++) {
    if (pos + 46 > b.length || v.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP corrompido.');
    const flags = v.getUint16(pos + 8, true); const metodo = v.getUint16(pos + 10, true);
    const tamComp = v.getUint32(pos + 20, true); const tamOrig = v.getUint32(pos + 24, true);
    const nNome = v.getUint16(pos + 28, true); const nExtra = v.getUint16(pos + 30, true); const nCom = v.getUint16(pos + 32, true);
    const ini = v.getUint32(pos + 42, true);
    const nome = dec.decode(b.subarray(pos + 46, pos + 46 + nNome));
    pos += 46 + nNome + nExtra + nCom;
    if (nome.endsWith('/') || nome.startsWith('__MACOSX/')) continue;
    if (flags & 1) throw new Error(`O arquivo ${nome} do ZIP é protegido por senha.`);
    total += tamOrig; if (total > LIMITE_TOTAL) throw new Error('O conteúdo do ZIP é grande demais. Envie em partes.');
    if (ini + 30 > b.length || v.getUint32(ini, true) !== 0x04034b50) throw new Error('ZIP corrompido.');
    const dados = ini + 30 + v.getUint16(ini + 26, true) + v.getUint16(ini + 28, true);
    const comp = b.subarray(dados, dados + tamComp);
    let bytes;
    if (metodo === 0) bytes = comp; else if (metodo === 8) bytes = await inflar(comp, tamOrig + 1024); else throw new Error(`O arquivo ${nome} usa compactação não suportada.`);
    saida.push({ nome: nome.split('/').pop(), caminho: nome, bytes });
  }
  return saida;
}

/** Gera um ZIP (sem compactação, o que basta para PDFs) a partir de [{ nome, bytes }]. */
export function escreverZip(arquivos) {
  const enc = new TextEncoder(); const partes = []; const central = []; let pos = 0;
  const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const junta = (...a) => { const t = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { t.set(x, p); p += x.length; } return t; };
  for (const { nome, bytes } of arquivos) {
    const n = enc.encode(nome); const crc = crc32(bytes);
    const local = junta(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(bytes.length), u32(bytes.length), u16(n.length), u16(0), n);
    partes.push(local, bytes);
    central.push(junta(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(bytes.length), u32(bytes.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(pos), n));
    pos += local.length + bytes.length;
  }
  const tamCentral = central.reduce((s, x) => s + x.length, 0);
  const fim = junta(u32(0x06054b50), u16(0), u16(0), u16(arquivos.length), u16(arquivos.length), u32(tamCentral), u32(pos), u16(0));
  return new Blob([...partes, ...central, fim], { type: 'application/zip' });
}
