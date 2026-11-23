/**
 * Nexo Fiscal — Configurações e assinatura
 * Uso do plano (CNPJs, simulações, PDFs), dados do escritório (saem nos relatórios) e chaves de API.
 * Assinatura paga pelo Asaas (Pix, boleto ou cartão); sem cobrança configurada, "Aumentar limite" leva ao contato comercial.
 */
import { el, limpar, aviso, campo, toast } from '../utils.js';
import { carregarEscritorio, salvarEscritorio, reduzirLogo } from '../escritorio.js';

const PLANOS = { gratuito: 'Gratuito', profissional: 'Profissional', ilimitado: 'Ilimitado' };
const NOMES = { empresas: 'CNPJs cadastrados', calculo: 'Simulações no mês', danfse: 'PDFs DANFSe no mês' };
const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

export class Configuracoes {
  constructor(state, api, router) { this.state = state; this.api = api; this.router = router; this.esc = {}; }

  render() {
    const div = el('div', { id: 'aba-configuracoes' });
    div.append(el('div', { class: 'page-head' }, el('div', { class: 'eyebrow' }, 'Conta'), el('h1', {}, 'Configurações e assinatura'), el('p', {}, 'Seu plano, os dados do escritório que saem nos relatórios e as chaves de integração.')),
      el('div', { class: 'card', id: 'cfg-plano' }, el('h2', {}, 'Plano e uso')),
      el('div', { class: 'card', id: 'cfg-escritorio' }, el('h2', {}, 'Dados do escritório (marca nos relatórios)')),
      el('div', { class: 'card' }, el('h2', {}, 'Chaves de API (integração)'), el('p', { class: 'mut' }, 'Para ligar o seu sistema de gestão ao simulador. Peça ao responsável de TI.'),
        el('details', {}, el('summary', {}, 'Gerenciar chaves'),
          el('div', { class: 'grid', style: 'margin-top:10px' }, campo('Nome da nova chave', 'ex.: Sistema de vendas', el('input', { id: 'k-nome', maxlength: 80 }), 'k-nome')),
          el('div', { class: 'row' }, el('button', { class: 'sec', id: 'k-criar' }, 'Criar chave')), el('div', { id: 'k-msg', role: 'status' }),
          el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ['Nome', 'Início', 'Último uso', ''].map((t) => el('th', {}, t)))), el('tbody', { id: 'k-lista' }))))));
    return div;
  }

  async mount() {
    this.esc = await carregarEscritorio(this.api);
    this.desenharEscritorio(); this.carregarChaves();
    document.getElementById('k-criar').onclick = () => this.criarChave();
    try { this.desenharPlano(await this.api.get('/usage')); } catch (e) { document.getElementById('cfg-plano').append(el('div', { class: 'msg err' }, 'Não foi possível carregar o uso do plano.')); }
  }

  desenharPlano(u) {
    const c = document.getElementById('cfg-plano'); limpar(c); c.append(el('h2', {}, 'Plano e uso'));
    c.append(el('div', {}, el('div', { class: 'mut small' }, 'Plano atual'), el('strong', {}, PLANOS[u.plano] || u.plano)));
    for (const [rec, v] of Object.entries(u.uso)) {
      const p = v.limite === null ? 0 : Math.min(100, (v.usado / Math.max(1, v.limite)) * 100);
      c.append(el('div', { style: 'margin-top:12px' }, el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:4px' }, el('span', {}, NOMES[rec] || rec),
        el('strong', {}, v.limite === null ? `${v.usado.toLocaleString('pt-BR')} (sem limite)` : `${v.usado.toLocaleString('pt-BR')} de ${v.limite.toLocaleString('pt-BR')}`)),
        el('div', { class: 'bar' }, el('i', { style: `width:${p}%;background:${p > 85 ? 'var(--red)' : p > 65 ? 'var(--amber)' : 'var(--teal)'}` }))));
    }
    c.append(el('p', { class: 'mut small', style: 'margin-top:12px' }, 'Os limites de simulações e PDFs zeram todo mês. O limite de CNPJs é a quantidade de empresas cadastradas ao mesmo tempo.'));
    c.append(el('div', { id: 'assinatura', style: 'margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)' }));
    this.carregarAssinatura();
  }

  // ---------- assinatura (Asaas) ----------

  async carregarAssinatura() {
    const c = document.getElementById('assinatura'); if (!c) return;
    try {
      const [st, pl] = await Promise.all([this.api.get('/me/assinatura'), this.api.get('/planos')]);
      this.desenharAssinatura(c, st, pl.planos);
    } catch {
      limpar(c); c.append(el('a', { class: 'sec', style: 'display:inline-block;padding:8px 14px;border-radius:8px', href: 'mailto:contato@nexofiscal.com.br?subject=Aumentar%20limite%20do%20plano' }, 'Aumentar limite'));
    }
  }

  desenharAssinatura(c, st, planos) {
    limpar(c);
    c.append(el('h3', {}, 'Assinatura'));
    const a = st.assinatura;
    const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const recarregar = el('button', { class: 'sec', style: 'margin-left:8px' }, 'Atualizar');
    recarregar.onclick = () => this.carregarAssinatura();

    if (st.plano_vencido) c.append(el('div', { class: 'msg warn' }, `Seu plano venceu e a conta voltou ao Gratuito. Pague a fatura em aberto para reativar.`));
    if (a?.status === 'aguardando_pagamento') {
      c.append(el('div', { class: 'msg' }, `Assinatura do plano ${PLANOS[a.plano]} aguardando pagamento. Assim que o Asaas confirmar, o plano muda sozinho (pode levar alguns minutos no boleto).`));
    } else if (a?.status === 'ativa') {
      c.append(el('p', {}, `Plano ${PLANOS[a.plano]} ativo, pago até ${fmtData(a.valido_ate)}. Renovação mensal.`));
    } else if (a?.status === 'cancelada' && a.valido_ate && new Date(a.valido_ate) > new Date()) {
      c.append(el('p', {}, `Assinatura cancelada. O plano ${PLANOS[st.plano] || st.plano} continua até ${fmtData(a.valido_ate)}.`));
    } else if (a?.status === 'suspensa') {
      c.append(el('div', { class: 'msg warn' }, 'Assinatura suspensa por estorno ou contestação do pagamento. Fale com o suporte ou contrate novamente.'));
    }
    const acoes = el('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0' });
    if (a?.url) acoes.append(el('a', { class: 'sec', style: 'display:inline-block;padding:8px 14px;border-radius:8px', href: a.url, target: '_blank', rel: 'noopener noreferrer' }, 'Pagar fatura'));
    if (a && a.status !== 'cancelada' && a.status !== 'suspensa') {
      const cancelar = el('button', { class: 'sec' }, 'Cancelar assinatura');
      cancelar.onclick = async () => {
        if (!window.confirm('Cancelar a assinatura? O plano continua até o fim do período já pago.')) return;
        try { const r = await this.api.delete('/me/assinatura'); toast(r.mensagem, 'ok', 6000); this.carregarAssinatura(); } catch (e) { toast(e.message, 'err', 6000); }
      };
      acoes.append(cancelar);
    }
    if (a) acoes.append(recarregar);
    c.append(acoes);

    if (!st.cobranca_ativa) {
      c.append(el('a', { class: 'sec', style: 'display:inline-block;padding:8px 14px;border-radius:8px', href: 'mailto:contato@nexofiscal.com.br?subject=Aumentar%20limite%20do%20plano' }, 'Aumentar limite'));
      return;
    }
    const lista = el('div', { class: 'grid' });
    for (const id of ['profissional', 'ilimitado']) {
      const lim = planos[id] || {};
      const txt = (n) => (n === null || n === undefined ? 'sem limite' : n.toLocaleString('pt-BR'));
      const atual = a?.status === 'ativa' && a.plano === id && !st.plano_vencido;
      const botao = el('button', { disabled: atual }, atual ? 'Plano atual' : `Assinar ${PLANOS[id]}`);
      botao.onclick = () => this.formularioAssinar(c, id, st.precos[id]);
      lista.append(el('div', { class: 'card', style: 'padding:14px' },
        el('strong', {}, PLANOS[id]), el('div', { style: 'font-size:1.4em;margin:4px 0' }, `${brl(st.precos[id])}/mês`),
        el('ul', { class: 'mut small', style: 'padding-left:18px;margin:6px 0 10px' },
          el('li', {}, `${txt(lim.empresas)} CNPJs`), el('li', {}, `${txt(lim.calculo)} simulações por mês`), el('li', {}, `${txt(lim.danfse)} PDFs DANFSe por mês`)),
        botao));
    }
    c.append(lista, el('div', { id: 'assinar-form' }));
  }

  formularioAssinar(c, plano, preco) {
    const caixa = document.getElementById('assinar-form'); limpar(caixa);
    const doc = el('input', { id: 'as-doc', inputmode: 'numeric', maxlength: 18, placeholder: 'CPF ou CNPJ de quem paga', autocomplete: 'off' });
    const nome = el('input', { id: 'as-nome', maxlength: 120, placeholder: 'Nome ou razão social na cobrança', value: this.state.user?.nome || '' });
    const ir = el('button', {}, `Ir para o pagamento (${preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês)`);
    ir.onclick = async () => {
      ir.disabled = true; aviso('as-msg');
      try {
        const r = await this.api.post('/me/assinatura', { plano, cpfCnpj: doc.value, nome: nome.value });
        if (r.url) window.open(r.url, '_blank', 'noopener');
        toast(r.url ? 'Fatura aberta em outra aba. Escolha Pix, boleto ou cartão.' : 'Assinatura criada. O link da fatura aparece aqui em instantes.', 'ok', 7000);
        this.carregarAssinatura();
      } catch (e) { aviso('as-msg', e.message, 'err'); }
      ir.disabled = false;
    };
    caixa.append(el('div', { class: 'card', style: 'padding:14px;margin-top:12px' }, el('h3', {}, `Assinar plano ${PLANOS[plano]}`),
      campo('CPF ou CNPJ', 'quem vai pagar', doc, 'as-doc'), campo('Nome na cobrança', '', nome, 'as-nome'),
      el('div', { id: 'as-msg' }), el('div', { class: 'row', style: 'margin-top:10px' }, ir),
      el('p', { class: 'mut small' }, 'O pagamento é feito no ambiente seguro do Asaas (Pix, boleto ou cartão). Não guardamos dados de cartão.')));
    doc.focus();
  }

  desenharEscritorio() {
    const c = document.getElementById('cfg-escritorio'); limpar(c); const e = this.esc;
    c.append(el('h2', {}, 'Dados do escritório (marca nos relatórios)'));
    const f = { nome: el('input', { id: 'e-nome', maxlength: 80, value: e.nome || '', placeholder: 'ex.: Sousa Contabilidade' }), responsavel: el('input', { id: 'e-resp', maxlength: 80, value: e.responsavel || '' }),
      crc: el('input', { id: 'e-crc', maxlength: 30, value: e.crc || '', placeholder: 'ex.: CRC-AC 000000/O' }), contato: el('input', { id: 'e-contato', maxlength: 120, value: e.contato || '', placeholder: 'e-mail ou telefone' }), cor: el('input', { id: 'e-cor', type: 'color', value: e.cor || '#0f766e' }) };
    let logo = e.logo || null;
    const previa = el('img', { class: 'logo-previa', alt: 'Logotipo', src: logo || '', hidden: !logo });
    const arq = el('input', { type: 'file', id: 'e-logo', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    arq.onchange = async () => { const a = arq.files[0]; if (!a) return; try { logo = await reduzirLogo(a); previa.src = logo; previa.hidden = false; aviso('e-msg'); } catch (err) { aviso('e-msg', err.message, 'err'); } };
    c.append(el('div', { class: 'grid' }, campo('Nome do escritório', null, f.nome, 'e-nome'), campo('Responsável técnico', null, f.responsavel, 'e-resp'), campo('CRC', 'Sai no rodapé dos relatórios', f.crc, 'e-crc'), campo('Contato', null, f.contato, 'e-contato'), campo('Cor do relatório', null, f.cor, 'e-cor')),
      el('div', {}, el('div', { class: 'mut small' }, 'Logotipo'), previa, el('div', { class: 'row' }, el('button', { class: 'sec', onclick: () => arq.click() }, 'Escolher imagem'), el('button', { class: 'sec', onclick: () => { logo = null; previa.hidden = true; } }, 'Sem logotipo')), arq),
      el('div', { id: 'e-msg', role: 'alert' }),
      el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { id: 'e-salvar', onclick: async (ev) => {
        ev.target.disabled = true;
        try { this.esc = await salvarEscritorio(this.api, { nome: f.nome.value, responsavel: f.responsavel.value, crc: f.crc.value, contato: f.contato.value, cor: f.cor.value, logo }); aviso('e-msg', 'Dados salvos. Já valem para os próximos relatórios.', 'ok'); }
        catch (err) { aviso('e-msg', err.message, 'err'); }
        ev.target.disabled = false; } }, 'Salvar dados')));
  }

  async carregarChaves() {
    const t = document.getElementById('k-lista'); if (!t) return; limpar(t);
    try {
      const { chaves } = await this.api.get('/keys');
      const ativas = chaves.filter((k) => !k.revogada_em);
      if (!ativas.length) t.append(el('tr', {}, el('td', { colspan: 4, class: 'mut' }, 'Nenhuma chave criada.')));
      ativas.forEach((k) => t.append(el('tr', {}, el('td', {}, `${k.nome} (${k.prefixo}…)`), el('td', {}, fmtData(k.criado_em)), el('td', {}, fmtData(k.ultimo_uso_em)),
        el('td', {}, el('button', { class: 'link', onclick: async () => { if (!confirm(`Revogar a chave "${k.nome}"? Sistemas que a usam deixam de funcionar.`)) return; try { await this.api.delete(`/keys/${k.id}`); toast('Chave revogada.', 'ok'); this.carregarChaves(); } catch (e) { toast(e.message, 'err'); } } }, 'Revogar')))));
    } catch (e) { t.append(el('tr', {}, el('td', { colspan: 4 }, 'Não foi possível listar as chaves.'))); }
  }

  async criarChave() {
    const nome = document.getElementById('k-nome').value.trim(); if (!nome) return aviso('k-msg', 'Dê um nome para a chave.', 'warn');
    try {
      const r = await this.api.post('/keys', { nome });
      const m = document.getElementById('k-msg'); limpar(m);
      m.append(el('div', { class: 'msg ok' }, 'Guarde esta chave agora: ela não será exibida de novo.', el('div', {}, el('code', { id: 'k-valor', style: 'word-break:break-all' }, r.chave))));
      document.getElementById('k-nome').value = ''; this.carregarChaves();
    } catch (e) { aviso('k-msg', e.message, 'err'); }
  }

  unmount() {}
}
