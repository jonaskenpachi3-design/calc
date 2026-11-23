/** Salva (ou substitui) os totais do lote atual na Visão geral. Só totais; nunca notas ou itens. */
import { lote, persistirLote } from './lote-store.js';
import { totais, comparativoAtual } from './lote-engine.js';

function corpo(res, regime, atuais) {
  const t = totais(res);
  const c = atuais && regime === 'regime-normal' ? comparativoAtual(res, null) : null;
  const comparavel = c && c.comparavel;
  return { origem: 'lote', regime, documentos: t.operacoes, itens: t.itens, itensComProblema: t.itensComProblema, base: t.base, cbs: t.cbs, ibs: t.ibs, impostoSeletivo: 0, total: t.total,
    tributosAtuais: comparavel ? Math.round(c.atual * 100) / 100 : null, cbsIbsComparavel: comparavel ? Math.round(c.novo * 100) / 100 : null };
}

export async function salvarLote(api, state) {
  const empresa = state.empresaAtiva; if (!empresa || !lote.res.length) return false;
  try {
    for (const id of lote.salvos || []) await api.delete(`/empresas/${empresa.cnpj}/analises/${id}`).catch(() => {});
    lote.salvos = [];
    const r = await api.post(`/empresas/${empresa.cnpj}/analises`, corpo(lote.res, lote.regime, true)); lote.salvos.push(r.id);
    if (lote.resAlt.length) { const r2 = await api.post(`/empresas/${empresa.cnpj}/analises`, corpo(lote.resAlt, 'simples-nacional', false)); lote.salvos.push(r2.id); }
    persistirLote(state.user?.id); // guarda também os ids das análises salvas
    return true;
  } catch { return false; }
}
