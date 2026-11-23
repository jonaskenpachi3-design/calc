/**
 * Salva só os totais de uma análise (nunca notas nem itens) para alimentar a Visão geral.
 * Falha em silêncio: não salvar não pode atrapalhar o cálculo que o usuário acabou de fazer.
 */
export async function salvarAnalise(api, state, { origem, regime, resultado, documentos = 1, tributosAtuais = null, cbsIbsComparavel = null }) {
  const empresa = state.empresaAtiva;
  if (!empresa || !resultado?.totais) return false;
  const t = resultado.totais;
  const itens = resultado.itens || [];
  try {
    await api.post(`/empresas/${empresa.cnpj}/analises`, {
      origem, regime, documentos, itens: itens.length,
      itensComProblema: itens.filter((i) => i.situacao === 'erro' || (i.mensagens || []).length).length,
      base: t.base || 0, cbs: t.cbs || 0, ibs: t.ibs || 0, impostoSeletivo: t.impostoSeletivo || 0, total: t.total || 0,
      tributosAtuais, cbsIbsComparavel,
    });
    return true;
  } catch { return false; }
}
