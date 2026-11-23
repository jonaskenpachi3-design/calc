/**
 * Cliente mínimo da API do Asaas (cobrança por assinatura). Sem dependências.
 * Documentação: https://docs.asaas.com — chave em `access_token`; User-Agent identificando o app.
 */
export class ErroAsaas extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

export function criarAsaas(config) {
  const c = config.asaas || {};
  const ativo = !!c.apiKey;

  async function req(metodo, caminho, corpo) {
    if (!ativo) throw new ErroAsaas(503, 'Cobrança não configurada');
    let r;
    try {
      r = await fetch(`${c.url}${caminho}`, {
        method: metodo,
        signal: AbortSignal.timeout(c.timeoutMs || 15000),
        headers: { 'content-type': 'application/json', access_token: c.apiKey, 'user-agent': 'NexoFiscal/1.0' },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch (e) {
      throw new ErroAsaas(502, `Não foi possível falar com o Asaas (${e.message})`);
    }
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) {
      const motivo = dados?.errors?.[0]?.description || `erro ${r.status}`;
      throw new ErroAsaas(r.status, motivo);
    }
    return dados;
  }

  return {
    ativo,
    criarCliente: ({ nome, cpfCnpj, email, referencia }) => req('POST', '/customers', { name: nome, cpfCnpj, email, externalReference: referencia }),
    criarAssinatura: ({ cliente, valor, primeiroVencimento, descricao, referencia }) => req('POST', '/subscriptions', {
      customer: cliente, billingType: 'UNDEFINED', value: valor, nextDueDate: primeiroVencimento, cycle: 'MONTHLY',
      description: descricao, externalReference: referencia,
    }),
    /** Cobranças já geradas da assinatura (a primeira costuma existir logo após criar). */
    cobrancas: async (assinaturaId) => (await req('GET', `/subscriptions/${encodeURIComponent(assinaturaId)}/payments`)).data || [],
    removerAssinatura: (assinaturaId) => req('DELETE', `/subscriptions/${encodeURIComponent(assinaturaId)}`),
  };
}

/** CPF ou CNPJ com dígitos verificadores corretos (só números). */
export function documentoValido(doc) {
  const d = String(doc ?? '').replace(/\D/g, '');
  if (/^(\d)\1+$/.test(d)) return false;
  const dv = (base, pesos) => { const r = base.split('').reduce((a, n, i) => a + Number(n) * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  if (d.length === 11) return dv(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[9]) && dv(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[10]);
  if (d.length === 14) return dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12]) && dv(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13]);
  return false;
}
