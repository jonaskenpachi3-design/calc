// Chamadas aos serviços oficiais da Receita (regime regular, Simples Nacional, DANFSe).
// Eles não têm autenticação própria: só o gateway deve alcançá-los (rede interna do compose).

const CABECALHOS_REPASSADOS = new Set(['content-type', 'content-disposition']);

// Teto do corpo de resposta lido em memória (os serviços oficiais devolvem JSON e PDFs pequenos).
const MAX_CORPO_BYTES = 50 * 1024 * 1024;

export async function chamar(url, { method = 'GET', headers = {}, body, timeoutMs = 30000, maxBytes = MAX_CORPO_BYTES } = {}) {
  try {
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    if (Number(res.headers.get('content-length')) > maxBytes) {
      res.body?.cancel().catch(() => {});
      return { ok: false, motivo: 'resposta_grande_demais' };
    }
    const corpo = Buffer.from(await res.arrayBuffer());
    if (corpo.length > maxBytes) return { ok: false, motivo: 'resposta_grande_demais' };
    const repassar = {};
    for (const [nome, valor] of res.headers) {
      // Cabeçalhos X-* trazem a versão da calculadora/base: úteis para auditoria fiscal.
      if (CABECALHOS_REPASSADOS.has(nome) || (nome.startsWith('x-') && nome !== 'x-request-id')) {
        repassar[nome] = valor;
      }
    }
    return { ok: true, status: res.status, headers: repassar, body: corpo };
  } catch (e) {
    return { ok: false, motivo: e?.name === 'TimeoutError' ? 'timeout' : 'indisponivel' };
  }
}

// Cache simples em memória para consultas de tabelas oficiais (mudam por versão da base).
export class CacheTtl {
  constructor(ttlMs = 5 * 60 * 1000, max = 500) {
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 5 * 60 * 1000;
    this.max = Number.isInteger(max) && max > 0 ? max : 500;
    this.mapa = new Map();
  }
  get(chave) {
    const item = this.mapa.get(chave);
    if (!item) return undefined;
    if (item.expira < Date.now()) {
      this.mapa.delete(chave);
      return undefined;
    }
    // Leitura recente vai para o fim: sai primeiro quem foi usado há mais tempo (LRU).
    this.mapa.delete(chave);
    this.mapa.set(chave, item);
    return item.valor;
  }
  set(chave, valor) {
    this.mapa.delete(chave);
    if (this.mapa.size >= this.max) this.mapa.delete(this.mapa.keys().next().value);
    this.mapa.set(chave, { valor, expira: Date.now() + this.ttlMs });
  }
}
