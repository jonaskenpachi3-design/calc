/**
 * Nexo Fiscal — Central de DANFSe
 * Converte XML de NFS-e em PDF pelo gerador oficial. Os XML são lidos neste computador, enviados um a um
 * para o gerador e NÃO ficam guardados; o histórico mostra só data, status e duração.
 */
import { el, limpar, aviso, downloadBlob, toast } from '../utils.js';
import { lerZip, escreverZip } from '../zip.js';

const MAX = 100;
const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export class DanfseCentral {
  constructor(state, api, router) { this.state = state; this.api = api; this.router = router; this.itens = []; }

  render() {
    const div = el('div', { id: 'aba-danfse' });
    div.append(el('div', { class: 'page-head' }, el('div', { class: 'eyebrow' }, 'Documento auxiliar'), el('h1', {}, 'Central de DANFSe'), el('p', {}, 'Gere o PDF das NFS-e a partir dos XML autorizados, um por um ou em lote.')),
      el('div', { class: 'card' }, el('h2', {}, 'Gerar PDFs'),
        el('div', { class: 'drop', id: 'drop' }, el('h3', {}, 'Arraste aqui ou escolha os XML'), el('p', { class: 'mut' }, `XML de NFS-e ou um ZIP com vários XML · até ${MAX} por vez`),
          el('input', { type: 'file', id: 'danfse-arq', multiple: true, accept: '.xml,.zip', hidden: true }), el('div', { class: 'row', style: 'justify-content:center' }, el('button', { id: 'danfse-escolher' }, 'Escolher arquivos'))),
        el('label', { style: 'margin-top:10px' }, el('input', { type: 'checkbox', id: 'canhoto' }), 'Incluir canhoto no PDF'),
        el('p', { class: 'mut small' }, 'O gerador oficial só aceita o XML da nota. Para notas sem XML, emita ou baixe o XML no portal da prefeitura ou no emissor nacional. Cada PDF conta na cota mensal do plano.'),
        el('div', { id: 'danfse-msg', role: 'alert' }), el('div', { class: 'bar', id: 'danfse-barra', hidden: true }, el('i', { id: 'danfse-i', style: 'width:0%' })), el('div', { id: 'danfse-lista' })),
      el('div', { class: 'card' }, el('h2', {}, 'Histórico recente'), el('p', { class: 'mut small' }, 'Só data, resultado e tempo. O conteúdo dos XML nunca é guardado.'), el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ['Data', 'Resultado', 'Duração'].map((t) => el('th', {}, t)))), el('tbody', { id: 'danfse-hist' })))));
    return div;
  }

  mount() {
    document.getElementById('danfse-escolher').onclick = () => document.getElementById('danfse-arq').click();
    document.getElementById('danfse-arq').onchange = (e) => this.receber([...e.target.files]);
    const z = document.getElementById('drop');
    ['dragenter', 'dragover'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', (e) => this.receber([...e.dataTransfer.files]));
    this.historico(); this.desenharLista();
  }

  async receber(arquivos) {
    if (!arquivos.length) return;
    const xmls = [];
    try {
      for (const f of arquivos) {
        if (/\.zip$/i.test(f.name)) { for (const e of await lerZip(await f.arrayBuffer())) if (/\.xml$/i.test(e.nome)) xmls.push({ nome: e.nome, texto: new TextDecoder().decode(e.bytes) }); }
        else if (/\.xml$/i.test(f.name)) xmls.push({ nome: f.name, texto: await f.text() });
        else throw new Error(`Formato não suportado: ${f.name}. Use XML ou ZIP.`);
      }
      if (!xmls.length) throw new Error('Nenhum XML encontrado.');
      if (xmls.length > MAX) throw new Error(`Foram encontrados ${xmls.length} XML. Envie até ${MAX} por vez.`);
    } catch (e) { return aviso('danfse-msg', e.message, 'err'); }
    aviso('danfse-msg'); this.itens = xmls.map((x) => ({ ...x, estado: 'espera' })); this.desenharLista();
    await this.gerar();
  }

  async pdf(texto) {
    const canhoto = document.getElementById('canhoto').checked;
    const r = await fetch(`/v1/danfse?canhoto=${canhoto}`, { method: 'POST', headers: { 'content-type': 'application/xml', authorization: `Bearer ${this.state.token}` }, body: texto });
    if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j?.erro?.mensagem || `Erro ${r.status}`); e.status = r.status; throw e; }
    return new Uint8Array(await r.arrayBuffer());
  }

  async gerar() {
    const barra = document.getElementById('danfse-barra'); const prog = document.getElementById('danfse-i'); barra.hidden = false; let feitos = 0; let fila = [...this.itens];
    const trabalhar = async () => {
      while (fila.length && !this.parar) {
        const it = fila.shift(); it.estado = 'gerando';
        try { it.bytes = await this.pdf(it.texto); it.estado = 'ok'; } catch (e) { it.estado = 'erro'; it.erro = e.message; if (e.status === 402 || e.status === 429) { this.parar = true; fila = []; aviso('danfse-msg', e.message, 'err'); } }
        feitos++; prog.style.width = `${Math.round((feitos / this.itens.length) * 100)}%`; this.desenharLista();
      }
    };
    this.parar = false;
    await Promise.all([trabalhar(), trabalhar(), trabalhar()]);
    for (const it of this.itens) if (it.estado === 'espera') { it.estado = 'erro'; it.erro = 'Não processado (limite do plano atingido).'; }
    barra.hidden = true; this.desenharLista(); this.historico();
  }

  desenharLista() {
    const c = document.getElementById('danfse-lista'); if (!c) return; limpar(c);
    if (!this.itens.length) return;
    const ok = this.itens.filter((i) => i.estado === 'ok'); const nome = (n) => n.replace(/\.xml$/i, '') + '.pdf';
    const rotulo = { espera: 'Na fila', gerando: 'Gerando…', ok: 'PDF pronto', erro: 'Erro' };
    c.append(el('div', { class: 'row', style: 'margin:10px 0' },
      ok.length > 1 ? el('button', { id: 'baixar-zip', onclick: () => downloadBlob(escreverZip(ok.map((i) => ({ nome: nome(i.nome), bytes: i.bytes }))), 'danfse.zip') }, `⇩ Baixar ${ok.length} PDFs (ZIP)`) : null,
      el('span', { class: 'mut small' }, `${ok.length} de ${this.itens.length} gerado(s)`)));
    c.append(el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ['Arquivo', 'Situação', ''].map((t) => el('th', {}, t)))), el('tbody', {}, this.itens.map((i) => el('tr', { 'data-estado': i.estado },
      el('td', {}, i.nome), el('td', {}, el('span', { class: 'badge ' + (i.estado === 'erro' ? 'erro' : i.estado === 'ok' ? 'calculado' : 'indisponivel') }, rotulo[i.estado]), i.erro ? el('div', { class: 'small', style: 'color:var(--red)' }, i.erro) : null),
      el('td', {}, i.estado === 'ok' ? el('button', { class: 'link', onclick: () => downloadBlob(new Blob([i.bytes], { type: 'application/pdf' }), nome(i.nome)) }, 'Baixar PDF') : null,
        i.estado === 'ok' && this.state.user?.email_ativo ? el('button', { class: 'link', style: 'margin-left:10px', onclick: (ev) => this.formEmail(ev.target.parentElement, i, nome(i.nome)) }, 'Enviar por e-mail') : null)))))));
  }

  /** Troca a célula por um campo de e-mail; o PDF vai direto ao destinatário e não fica guardado no servidor. */
  formEmail(celula, item, arquivo) {
    limpar(celula);
    const campoEmail = el('input', { type: 'email', placeholder: 'e-mail do cliente', style: 'min-width:200px', 'aria-label': 'E-mail do destinatário' });
    const enviar = el('button', {}, 'Enviar');
    const cancelar = el('button', { class: 'link', onclick: () => this.desenharLista() }, 'Cancelar');
    enviar.onclick = async () => {
      enviar.disabled = true;
      try {
        let bin = ''; for (let k = 0; k < item.bytes.length; k += 0x8000) bin += String.fromCharCode(...item.bytes.subarray(k, k + 0x8000));
        await this.api.post('/v1/danfse/email', { para: campoEmail.value.trim(), nome: arquivo, pdf: btoa(bin) });
        toast(`DANFSe enviado para ${campoEmail.value.trim()}.`, 'ok', 5000); this.desenharLista();
      } catch (e) { toast(e.message, 'err', 6000); enviar.disabled = false; }
    };
    celula.append(campoEmail, enviar, cancelar); campoEmail.focus();
  }

  async historico() {
    const t = document.getElementById('danfse-hist'); if (!t) return; limpar(t);
    try {
      const { eventos } = await this.api.get('/history?limite=200');
      const d = eventos.filter((e) => e.recurso === 'danfse').slice(0, 10);
      if (!d.length) return t.append(el('tr', {}, el('td', { colspan: 3, class: 'mut' }, 'Nenhum PDF gerado ainda.')));
      d.forEach((e) => t.append(el('tr', {}, el('td', {}, dt(e.criadoEm)), el('td', {}, e.status === 200 ? 'PDF gerado' : `Falhou (${e.status})`), el('td', {}, `${e.duracaoMs} ms`))));
    } catch { t.append(el('tr', {}, el('td', { colspan: 3 }, 'Não foi possível carregar o histórico.'))); }
  }

  unmount() { this.parar = true; }
}
