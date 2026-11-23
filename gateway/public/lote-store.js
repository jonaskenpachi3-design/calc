/**
 * Estado compartilhado do lote entre as telas (Simulador em lote → Auditoria → Relatório).
 * Nada disso vai para o servidor além dos totais da análise. Para não perder o trabalho ao fechar a página,
 * uma cópia fica guardada neste computador (IndexedDB do navegador), por escritório e empresa, por até 7 dias.
 * Apagada ao clicar em Sair, em "Descartar lote" ou ao iniciar um novo lote.
 */
export const lote = {
  grupos: [], problemas: [], res: [], regime: null, formato: null,
  cenarioAlt: false, cfgAlt: { cbs: '', ibs: '', fatorR: false, sublimite: false, ativProduto: '', ativServico: '' },
  gruposAlt: [], problemasAlt: [], resAlt: [],
  cargaEstimada: '', salvos: [], cnpj: null,
  cache: {},
};

export function reiniciarLote() {
  Object.assign(lote, { grupos: [], problemas: [], res: [], regime: null, formato: null, gruposAlt: [], problemasAlt: [], resAlt: [], salvos: [], cnpj: null });
}
export const temLote = () => lote.res.length > 0;

const lista = (x) => (Array.isArray(x) ? x : x?.atividades || x?.itens || []);

/** Dependências do motor: acesso às tabelas oficiais (com cache) e mapa código IBGE → UF. */
export async function depsDoLote(api) {
  lote.cache.ufs = lote.cache.ufs || lista(await api.get('/v1/dados/ufs').catch(() => []));
  return {
    cache: lote.cache,
    dados: async (caminho) => lista(await api.get(caminho)),
    ufsPorCodigo: Object.fromEntries(lote.cache.ufs.map((u) => [String(u.codigo), u.sigla])),
  };
}

// ---------- cópia local (IndexedDB) ----------

const BANCO = 'nexo-lote', TABELA = 'lotes', VALIDADE_MS = 7 * 24 * 3600 * 1000;
const chave = (tenant, cnpj) => `${tenant}:${cnpj}`;

function abrir() {
  return new Promise((ok, erro) => {
    if (!('indexedDB' in window)) return erro(new Error('sem IndexedDB'));
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(TABELA);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}
async function usar(modo, fn) {
  const db = await abrir();
  try {
    return await new Promise((ok, erro) => {
      const tx = db.transaction(TABELA, modo);
      const res = fn(tx.objectStore(TABELA));
      tx.oncomplete = () => ok(res?.result);
      tx.onerror = () => erro(tx.error);
      tx.onabort = () => erro(tx.error);
    });
  } finally { db.close(); }
}

/** Guarda uma cópia do lote atual. Falhas (navegador sem IndexedDB, modo privado, cota) são ignoradas: o lote segue na memória. */
export async function persistirLote(tenantId) {
  if (!tenantId || !lote.cnpj || (!lote.res.length && !lote.grupos.length)) return false;
  try {
    const { cache, ...dados } = lote;
    await usar('readwrite', (t) => t.put({ salvoEm: Date.now(), dados: structuredClone(dados) }, chave(tenantId, lote.cnpj)));
    return true;
  } catch { return false; }
}

/** Traz de volta o lote guardado desta empresa. Devolve a data em que foi guardado, ou null se não há (ou se venceu). */
export async function restaurarLote(tenantId, cnpj) {
  if (!tenantId || !cnpj) return null;
  if (lote.cnpj === cnpj && (lote.res.length || lote.grupos.length)) return null; // já está na memória
  try {
    const r = await usar('readonly', (t) => t.get(chave(tenantId, cnpj)));
    if (!r) return null;
    if (Date.now() - r.salvoEm > VALIDADE_MS) { await descartarLote(tenantId, cnpj); return null; }
    reiniciarLote();
    Object.assign(lote, r.dados, { cnpj });
    return r.salvoEm;
  } catch { return null; }
}

export async function descartarLote(tenantId, cnpj) {
  try { await usar('readwrite', (t) => t.delete(chave(tenantId, cnpj))); } catch { /* nada a apagar */ }
}

/** Esquece o lote da memória e a cópia guardada (novo lote, descartar). */
export async function esquecerLote(tenantId) {
  const cnpj = lote.cnpj;
  reiniciarLote();
  if (cnpj) await descartarLote(tenantId, cnpj);
}

/** Ao sair da conta: apaga todas as cópias deste computador. */
export async function apagarTodosOsLotes() {
  reiniciarLote();
  try { await usar('readwrite', (t) => t.clear()); } catch { /* nada a apagar */ }
}
