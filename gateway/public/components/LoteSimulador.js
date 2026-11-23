/**
 * Nexo Fiscal — Simulador em lote
 * Arraste XML (NF-e, NFC-e, NFS-e), ZIP de XMLs ou a planilha CSV. Tudo é lido no navegador; só os dados
 * de cada operação seguem para a calculadora oficial, em partes, e nada é guardado no servidor além dos totais.
 */
import { el, limpar, aviso, campo, dinheiro, downloadBlob } from '../utils.js';
import { lote, reiniciarLote, depsDoLote, temLote } from '../lote-store.js';
import { lerArquivos, modeloCsv, processar, totais, gruposSimples, atividadesDe, comparativoRegimes, comparativoAtual, MAX_OPERACOES } from '../lote-engine.js';
import { salvarLote } from '../lote-salvar.js';

const NOME_REGIME = { 'regime-normal': 'Regime normal', 'simples-nacional': 'Simples Nacional' };

export class LoteSimulador {
  constructor(state, api, router) { this.state = state; this.api = api; this.router = router; }

  render() {
    const empresa = this.state.empresaAtiva;
    const div = el('div', { id: 'aba-lote' });
    div.append(
      el('div', { class: 'page-head' }, el('div', { class: 'eyebrow' }, 'Processamento em lote'), el('h1', {}, 'Simulador em lote'),
        el('p', {}, `Envie as notas de ${empresa?.razao_social || 'a empresa'} e veja a CBS e o IBS de cada uma, com comparativo.`)),
      el('div', { class: 'card' }, el('h2', {}, '1. Arquivos'),
        el('div', { class: 'drop', id: 'drop' },
          el('h3', {}, 'Arraste aqui ou escolha os arquivos'),
          el('p', { class: 'mut' }, 'XML de NF-e, NFC-e e NFS-e · ZIP com vários XML · planilha CSV'),
          el('p', { class: 'mut small' }, `Até ${MAX_OPERACOES} notas por lote. Os arquivos são lidos neste computador e não ficam guardados.`),
          el('input', { type: 'file', id: 'arquivo', multiple: true, accept: '.xml,.zip,.csv', hidden: true }),
          el('div', { class: 'row', style: 'justify-content:center' },
            el('button', { id: 'escolher' }, 'Escolher arquivos'),
            el('button', { class: 'sec', id: 'modelo-normal' }, '⇩ Modelo CSV (regime normal)'),
            el('button', { class: 'sec', id: 'modelo-simples' }, '⇩ Modelo CSV (Simples)'))),
        el('div', { id: 'lote-msg', role: 'alert' }), el('div', { id: 'previa' })),
      el('div', { class: 'card', id: 'cenarios', hidden: true }),
      el('div', { class: 'card', id: 'processar', hidden: true }),
      el('div', { id: 'concluido' }));
    return div;
  }

  async mount() {
    const cnpj = this.state.empresaAtiva?.cnpj;
    if (lote.cnpj && lote.cnpj !== cnpj) reiniciarLote();
    document.getElementById('escolher').onclick = () => document.getElementById('arquivo').click();
    document.getElementById('arquivo').onchange = (e) => this.receber([...e.target.files]);
    document.getElementById('modelo-normal').onclick = () => downloadBlob(new Blob([modeloCsv('regime-normal')], { type: 'text/csv;charset=utf-8' }), 'modelo-lote-regime-normal.csv');
    document.getElementById('modelo-simples').onclick = () => downloadBlob(new Blob([modeloCsv('simples-nacional')], { type: 'text/csv;charset=utf-8' }), 'modelo-lote-simples.csv');
    const z = document.getElementById('drop');
    ['dragenter', 'dragover'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', (e) => this.receber([...e.dataTransfer.files]));
    if (temLote()) this.mostrarConcluido(); else if (lote.grupos.length) this.mostrarPrevia();
  }

  regimeCsv() { return this.state.empresaAtiva?.regime_atual === 'simples-nacional' ? 'simples-nacional' : 'regime-normal'; }

  async receber(arquivos) {
    if (!arquivos.length) return;
    reiniciarLote(); limpar(document.getElementById('previa')); limpar(document.getElementById('concluido'));
    document.getElementById('cenarios').hidden = true; document.getElementById('processar').hidden = true;
    aviso('lote-msg', 'Lendo os arquivos…', 'warn');
    try {
      const deps = await depsDoLote(this.api);
      const r = await lerArquivos(arquivos, this.regimeCsv(), deps);
      Object.assign(lote, { grupos: r.grupos, problemas: r.problemas, regime: r.regime, formato: r.formato, cnpj: this.state.empresaAtiva?.cnpj });
      aviso('lote-msg'); this.mostrarPrevia();
    } catch (e) { aviso('lote-msg', e.message, 'err'); }
  }

  mostrarPrevia() {
    const p = document.getElementById('previa'); limpar(p);
    const n = lote.grupos.length;
    p.append(el('div', { class: n ? 'msg ok' : 'msg err' }, n ? `${n} operação(ões) lida(s) (${lote.formato === 'xml' ? 'XML' : 'planilha'}), prontas para simular no ${NOME_REGIME[lote.regime].toLowerCase()}.` : 'Nenhuma operação pôde ser lida.'));
    const semClasse = lote.grupos.filter((g) => g.entrada.itens.some((it) => !it.classificacao)).length;
    if (semClasse) p.append(el('div', { class: 'msg warn small' }, `${semClasse} nota(s) têm itens sem classificação tributária. A calculadora vai recusar esses itens e você corrige na Auditoria.`));
    if (lote.problemas.length) p.append(el('div', { class: 'msg warn small' }, `${lote.problemas.length} arquivo(s)/linha(s) não puderam ser lidos e ficam fora da simulação. Eles aparecem na Auditoria.`));
    if (lote.formato === 'xml' && this.state.empresaAtiva?.regime_atual === 'simples-nacional') p.append(el('div', { class: 'msg warn small' }, 'Esta empresa está no Simples Nacional, mas notas em XML são simuladas no regime normal (como referência). Para calcular o Simples use a planilha CSV.'));
    if (!n) return;
    this.desenharCenarios(); document.getElementById('processar').hidden = false; this.desenharProcessar();
  }

  async desenharCenarios() {
    const c = document.getElementById('cenarios'); limpar(c);
    const podeAlt = lote.regime === 'regime-normal';
    c.hidden = false;
    c.append(el('h2', {}, '2. Cenários'));
    c.append(el('label', { class: 'choice', style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, el('input', { type: 'checkbox', checked: true, disabled: true }), el('span', {}, el('strong', {}, `Regime ${lote.regime === 'regime-normal' ? 'normal' : 'Simples Nacional'}`), el('span', { class: 'mut small' }, ' — sempre simulado'))));
    const chk = el('input', { type: 'checkbox', id: 'cen-alt', checked: lote.cenarioAlt, disabled: !podeAlt });
    c.append(el('label', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, chk, el('span', {}, el('strong', {}, 'Também simular o Simples Nacional'), el('span', { class: 'mut small' }, podeAlt ? ' — comparativo de CBS e IBS entre os regimes' : ' — disponível quando o lote é de regime normal'))));
    const cfg = el('div', { id: 'cfg-alt', hidden: !lote.cenarioAlt });
    c.append(cfg);
    chk.onchange = async () => { lote.cenarioAlt = chk.checked; cfg.hidden = !chk.checked; if (chk.checked) await this.desenharCfgAlt(cfg); };
    if (lote.cenarioAlt) await this.desenharCfgAlt(cfg);
  }

  async desenharCfgAlt(cfg) {
    limpar(cfg);
    const k = lote.cfgAlt; const deps = await depsDoLote(this.api);
    const data = lote.grupos[0]?.entrada.data;
    const tem = (t) => lote.grupos.some((g) => g.entrada.itens.some((i) => i.tipo === t));
    const lis = async (tp) => (data ? atividadesDe(deps, data, tp) : []);
    const sel = (id, lista, atual, onch) => el('select', { id, onchange: (e) => onch(e.target.value) }, el('option', { value: '' }, 'Escolha'), lista.map((a) => el('option', { value: a.codigo, selected: a.codigo === atual }, `${a.codigo} – ${a.descricao}`.slice(0, 110))));
    const campos = [
      campo('Alíquota efetiva de CBS (%)', 'Do seu PGDAS-D. Ex.: 1,1612', el('input', { id: 'alt-cbs', inputmode: 'decimal', value: k.cbs, oninput: (e) => { k.cbs = e.target.value; } }), 'alt-cbs'),
      campo('Alíquota efetiva de IBS (%)', 'Ex.: 0,0129', el('input', { id: 'alt-ibs', inputmode: 'decimal', value: k.ibs, oninput: (e) => { k.ibs = e.target.value; } }), 'alt-ibs'),
    ];
    if (tem('produto')) campos.push(campo('Atividade dos produtos', 'Define o anexo do Simples', sel('alt-ap', await lis('55'), k.ativProduto, (v) => { k.ativProduto = v; }), 'alt-ap'));
    if (tem('servico')) campos.push(campo('Atividade dos serviços', 'Define o anexo do Simples', sel('alt-as', await lis('91'), k.ativServico, (v) => { k.ativServico = v; }), 'alt-as'));
    cfg.append(el('div', { class: 'msg warn small' }, 'As notas em XML não trazem os dados do Simples. Informe as alíquotas efetivas e a atividade: valem para todas as notas do lote. É uma estimativa de comparação, não a apuração do DAS.'),
      el('div', { class: 'grid' }, campos),
      el('label', { style: 'display:flex;gap:8px;align-items:center' }, el('input', { type: 'checkbox', checked: k.fatorR, onchange: (e) => { k.fatorR = e.target.checked; } }), 'Fator R aplicável (serviços do Anexo V → III)'),
      el('label', { style: 'display:flex;gap:8px;align-items:center' }, el('input', { type: 'checkbox', checked: k.sublimite, onchange: (e) => { k.sublimite = e.target.checked; } }), 'Ultrapassou o sublimite do Simples'));
  }

  desenharProcessar() {
    const c = document.getElementById('processar'); limpar(c);
    const n = lote.grupos.length;
    c.append(el('h2', {}, '3. Processar'), el('div', { id: 'proc-msg', role: 'alert' }),
      el('div', { class: 'bar', id: 'proc-barra', hidden: true }, el('i', { id: 'proc-i', style: 'width:0%' })),
      el('p', { class: 'mut small' }, `Cada operação conta como 1 simulação na sua cota${lote.cenarioAlt ? ' (o cenário do Simples conta de novo)' : ''}.`),
      el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'sec', id: 'limpar-lote' }, 'Limpar'), el('button', { id: 'processar-btn' }, `Simular ${n} operação(ões)`)));
    document.getElementById('limpar-lote').onclick = () => { reiniciarLote(); this.router.navigate('lote'); };
    document.getElementById('processar-btn').onclick = () => this.executar();
  }

  async executar() {
    const btn = document.getElementById('processar-btn'); btn.disabled = true; aviso('proc-msg');
    const barra = document.getElementById('proc-barra'); const prog = document.getElementById('proc-i'); barra.hidden = false;
    const deps = await depsDoLote(this.api);
    try {
      if (lote.cenarioAlt) {
        const k = lote.cfgAlt;
        if (!k.cbs.trim() || !k.ibs.trim()) throw new Error('Informe as alíquotas efetivas de CBS e IBS do Simples Nacional.');
        if (lote.grupos.some((g) => g.entrada.itens.some((i) => i.tipo === 'produto')) && !k.ativProduto) throw new Error('Escolha a atividade dos produtos para o Simples Nacional.');
        if (lote.grupos.some((g) => g.entrada.itens.some((i) => i.tipo === 'servico')) && !k.ativServico) throw new Error('Escolha a atividade dos serviços para o Simples Nacional.');
      }
      const total = lote.grupos.length * (lote.cenarioAlt ? 2 : 1);
      const mostrar = (feitas, desta, base = 0) => { prog.style.width = `${Math.round(((base + feitas) / total) * 100)}%`; aviso('proc-msg', `Simulando… ${base + feitas} de ${total}`, 'warn'); };
      lote.res = await processar(lote.grupos, this.api, (f) => mostrar(f, 0));
      lote.resAlt = []; lote.gruposAlt = []; lote.problemasAlt = [];
      if (lote.cenarioAlt) {
        const alt = await gruposSimples(lote.grupos, lote.cfgAlt, deps);
        lote.gruposAlt = alt.grupos; lote.problemasAlt = alt.problemas;
        lote.resAlt = await processar(alt.grupos, this.api, (f) => mostrar(f, 0, lote.grupos.length));
      }
      prog.style.width = '100%'; aviso('proc-msg');
      lote.salvos = []; this.mostrarConcluido();
    } catch (e) {
      aviso('proc-msg', e.message + (lote.res.length ? ` As ${lote.res.length} primeiras operações foram simuladas e contadas na sua cota.` : ''), 'err');
      btn.disabled = false; barra.hidden = true;
    }
  }

  mostrarConcluido() {
    const a = document.getElementById('concluido'); limpar(a);
    document.getElementById('processar').hidden = true; document.getElementById('cenarios').hidden = true;
    const t = totais(lote.res);
    const cards = [
      el('div', { class: 'kpi main' }, el('div', { class: 'v' }, dinheiro(t.total)), el('div', { class: 'l' }, 'CBS + IBS (regime ' + (lote.regime === 'regime-normal' ? 'normal' : 'Simples') + ')')),
      el('div', { class: 'kpi' }, el('div', { class: 'v' }, `${t.ok} de ${t.operacoes}`), el('div', { class: 'l' }, 'Operações sem problemas'))];
    if (lote.resAlt.length) { const c = comparativoRegimes(lote.res, lote.resAlt); cards.push(el('div', { class: 'kpi' }, el('div', { class: 'v' }, dinheiro(c.simples)), el('div', { class: 'l' }, `CBS + IBS no Simples (${c.comparadas} nota(s) comparada(s))`))); }
    else if (lote.regime === 'regime-normal') { const c = comparativoAtual(lote.res, null); if (c.comparavel) cards.push(el('div', { class: 'kpi' }, el('div', { class: 'v' }, dinheiro(c.atual)), el('div', { class: 'l' }, 'Tributos atuais informados nas notas'))); }
    a.append(el('div', { class: 'card' }, el('h2', {}, 'Lote processado'), el('div', { class: 'totals' }, cards),
      t.comProblema ? el('div', { class: 'msg warn' }, `${t.comProblema} operação(ões) com problema${lote.problemas.length ? ` e ${lote.problemas.length} arquivo(s)/linha(s) ilegíveis` : ''}. Corrija na Auditoria — itens com problema ficam fora dos totais até serem corrigidos.`) : el('div', { class: 'msg ok' }, 'Todas as operações foram calculadas sem problemas.'),
      el('div', { id: 'salvar-msg' }),
      el('div', { class: 'row' },
        el('button', { id: 'ir-auditoria' }, t.comProblema || lote.problemas.length ? 'Corrigir na Auditoria' : 'Ver Auditoria'),
        el('button', { class: 'sec', id: 'ir-relatorio' }, 'Gerar relatório'),
        el('button', { class: 'sec', id: 'salvar-visao' }, 'Salvar na Visão geral'),
        el('button', { class: 'sec', id: 'novo-lote' }, 'Novo lote'))));
    document.getElementById('ir-auditoria').onclick = () => this.router.navigate('auditoria');
    document.getElementById('ir-relatorio').onclick = () => this.router.navigate('relatorio');
    document.getElementById('novo-lote').onclick = () => { reiniciarLote(); this.router.navigate('lote'); };
    document.getElementById('salvar-visao').onclick = async (e) => {
      e.target.disabled = true;
      const ok = await salvarLote(this.api, this.state);
      aviso('salvar-msg', ok ? 'Totais salvos na Visão geral. Se corrigir itens depois, salve de novo para atualizar.' : 'Não foi possível salvar agora.', ok ? 'ok' : 'err');
      e.target.disabled = false;
    };
  }

  unmount() {}
}
