/**
 * Estado compartilhado do lote entre as telas (Simulador em lote → Auditoria → Relatório).
 * Fica só na memória do navegador; nada disso vai para o servidor além dos totais da análise.
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
