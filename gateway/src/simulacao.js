// Tradução entre o que o cliente preenche na tela (linguagem comum) e os contratos
// oficiais das calculadoras da Receita, e de volta para um resultado legível.
import crypto from 'node:crypto';

export class EntradaInvalida extends Error {}

// Alíquotas nominais de referência exigidas pela calculadora para fatos geradores a partir
// de 01/01/2027 (e proibidas antes). Os valores abaixo são os do exemplo oficial de teste:
// CONFIRME com a legislação vigente e ajuste por variável de ambiente.
export const ALIQUOTAS_REFERENCIA_PADRAO = { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 };

const DOCUMENTOS = { nfe: '55', nfce: '65', nfse: '91' };
const ATIVIDADES_COM_ISS = new Set(['07', '09', '10', '12', '13', '14']);

const exige = (cond, msg) => { if (!cond) throw new EntradaInvalida(msg); };

function dinheiro(v, campo) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  exige(Number.isFinite(n) && n > 0, `${campo}: informe um valor maior que zero`);
  exige(n < 1e11, `${campo}: valor muito alto`);
  return Math.round(n * 100) / 100;
}

function data(v) {
  exige(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), 'Informe a data da operação');
  return v;
}

function codigoProduto(item, n) {
  const tipo = item.tipo === 'servico' ? 'servico' : 'produto';
  const cod = String(item.codigo ?? '').replace(/\D/g, '');
  if (tipo === 'produto') {
    exige(/^\d{8}$/.test(cod), `Item ${n}: o código NCM do produto tem 8 números`);
    return { ncm: cod };
  }
  exige(/^\d{9}$/.test(cod), `Item ${n}: o código NBS do serviço tem 9 números`);
  return { nbs: cod };
}

function classificacao(item, n) {
  const c = String(item.classificacao ?? '').replace(/\D/g, '');
  exige(/^\d{6}$/.test(c), `Item ${n}: escolha a classificação tributária`);
  return c;
}

const novoIdOperacao = () => crypto.randomBytes(16).toString('hex');

// ---------------- Regime normal (CBS / IBS / IS) ----------------

export function montarRegimeNormal(entrada, aliquotas = ALIQUOTAS_REFERENCIA_PADRAO) {
  exige(entrada && typeof entrada === 'object', 'Preencha o formulário');
  const dia = data(entrada.data);
  const uf = String(entrada.uf ?? '').toUpperCase();
  exige(/^[A-Z]{2}$/.test(uf), 'Escolha o estado');
  const municipio = String(entrada.municipio ?? '').replace(/\D/g, '');
  exige(/^\d{7}$/.test(municipio), 'Escolha o município');
  exige(Array.isArray(entrada.itens) && entrada.itens.length >= 1, 'Inclua ao menos um item');
  exige(entrada.itens.length <= 100, 'No máximo 100 itens por simulação');

  const precisaAliquotas = dia >= '2027-01-01';
  const itens = entrada.itens.map((it, i) => {
    const n = i + 1;
    const cClassTrib = classificacao(it, n);
    const oficial = {
      numero: n,
      ...codigoProduto(it, n),
      cst: cClassTrib.slice(0, 3),
      cClassTrib,
      baseCalculo: dinheiro(it.valor, `Item ${n}`),
    };
    if (precisaAliquotas) oficial.aliquotasNominais = { ...aliquotas };
    return oficial;
  });

  return {
    id: novoIdOperacao(),
    versao: '1.0.0',
    dhFatoGerador: `${dia}T12:00:00-03:00`,
    municipio: Number(municipio),
    uf,
    itens,
  };
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const soma = (xs) => Math.round(xs.reduce((a, b) => a + (b ?? 0), 0) * 100) / 100;

const SITUACOES = {
  CALCULADO: { chave: 'calculado', texto: 'Calculado' },
  CALCULO_SIMULADO: { chave: 'calculado', texto: 'Calculado com alíquotas de referência' },
  INCONSISTENCIA_ENTRADA: { chave: 'erro', texto: 'Dados inconsistentes' },
  NAO_IMPLEMENTADO: { chave: 'indisponivel', texto: 'Ainda não calculável' },
  NAO_CALCULADO: { chave: 'indisponivel', texto: 'Não calculado' },
  FALHA_TECNICA: { chave: 'indisponivel', texto: 'Falha temporária no cálculo' },
};

const situacao = (estado) => SITUACOES[estado] ?? { chave: 'indisponivel', texto: 'Não calculado' };

function mensagensErro(erros) {
  return (erros ?? []).map((e) => [e.title, e.detail].filter(Boolean).join(': ') || 'Erro não identificado');
}

export function traduzirRegimeNormal(resp, entrada, avisoSimulado = false) {
  const objetos = Array.isArray(resp?.objetos) ? resp.objetos : [];
  const itens = objetos.map((o) => {
    const idx = (o.nObj ?? 0) - 1;
    const sit = situacao(o.estadoItem);
    const g = o.tribCalc?.IBSCBS?.gIBSCBS;
    const base = num(g?.vBC);
    const cbs = num(g?.gCBS?.vCBS);
    const ibsUf = num(g?.gIBSUF?.vIBSUF);
    const ibsMun = num(g?.gIBSMun?.vIBSMun);
    const ibs = num(g?.vIBS) ?? (ibsUf !== null || ibsMun !== null ? soma([ibsUf, ibsMun]) : null);
    const is = num(o.tribCalc?.IS?.vIS ?? o.tribCalc?.IS?.valor);
    return {
      numero: o.nObj,
      descricao: entrada?.itens?.[idx]?.descricao || `Item ${o.nObj}`,
      situacao: sit.chave,
      situacaoTexto: sit.texto,
      base,
      cbs,
      ibs,
      ibsEstadual: ibsUf,
      ibsMunicipal: ibsMun,
      impostoSeletivo: is,
      reducaoPercentual: num(g?.gCBS?.gRed?.pRedAliq),
      total: sit.chave === 'calculado' ? soma([cbs, ibs, is]) : null,
      mensagens: mensagensErro(o.erros),
    };
  });

  const calculados = itens.filter((i) => i.situacao === 'calculado');
  const totais = {
    base: soma(calculados.map((i) => i.base)),
    cbs: soma(calculados.map((i) => i.cbs)),
    ibs: soma(calculados.map((i) => i.ibs)),
    impostoSeletivo: soma(calculados.map((i) => i.impostoSeletivo)),
  };
  totais.total = soma([totais.cbs, totais.ibs, totais.impostoSeletivo]);

  const avisos = [];
  if (avisoSimulado || itens.some((i) => i.situacaoTexto.includes('referência'))) {
    avisos.push('Simulação feita com alíquotas de referência; os valores reais dependem da legislação vigente na data da operação.');
  }
  if (itens.some((i) => i.situacao !== 'calculado')) {
    avisos.push('Alguns itens não foram calculados. Corrija os dados indicados e simule novamente.');
  }
  return { itens, totais, avisos };
}

// ---------------- Simples Nacional ----------------

const ROMANOS = { I: 'anexoI', II: 'anexoII', III: 'anexoIII', IV: 'anexoIV', V: 'anexoV' };

function percentual(v, campo) {
  const n = Number(String(v ?? '').replace(',', '.'));
  exige(Number.isFinite(n) && n >= 0 && n <= 100, `${campo}: informe um percentual entre 0 e 100`);
  return n.toFixed(4);
}

export function montarSimples(entrada) {
  exige(entrada && typeof entrada === 'object', 'Preencha o formulário');
  const dia = data(entrada.data);
  const tpDoc = DOCUMENTOS[entrada.documento];
  exige(tpDoc, 'Escolha o tipo de documento');
  exige(Array.isArray(entrada.itens) && entrada.itens.length >= 1, 'Inclua ao menos um item');
  const nfse = tpDoc === '91';
  exige(!nfse || entrada.itens.length === 1, 'A nota de serviço (NFS-e) permite um item por simulação');
  exige(entrada.itens.length <= 100, 'No máximo 100 itens por simulação');

  const al = entrada.aliquotas ?? {};
  const chaveAnexo = ROMANOS[String(al.anexo ?? '').toUpperCase()];
  exige(chaveAnexo, 'Escolha o anexo do Simples Nacional');

  const par = { pCBSSN: percentual(al.cbs, 'Alíquota efetiva de CBS'), pIBSSN: percentual(al.ibs, 'Alíquota efetiva de IBS') };
  const aliquotasEfetivas = { impedimentoSublimite: !!al.impedimentoSublimite, [chaveAnexo]: par };
  if (al.fatorR !== undefined && al.fatorR !== null) aliquotasEfetivas.fatorR = !!al.fatorR;

  const itens = entrada.itens.map((it, i) => {
    const n = i + 1;
    const atividade = String(it.atividade ?? '').replace(/\D/g, '').padStart(2, '0');
    exige(/^\d{2}$/.test(atividade), `Item ${n}: escolha a atividade`);
    const oficial = {
      numero: n,
      cAtivSN: atividade,
      cClassTrib: classificacao(it, n),
      ...(it.tipo === 'servico' ? codigoProduto(it, n) : codigoProduto({ ...it, tipo: 'produto' }, n)),
      baseCalculo: dinheiro(it.valor, `Item ${n}`).toFixed(2),
    };
    // Os códigos NCM/NBS oficiais usam as chaves ncm/nbs em minúsculas na entrada.
    if (nfse) {
      if (ATIVIDADES_COM_ISS.has(atividade)) { oficial.tribISSQN = '1'; oficial.tpRetISSQN = '1'; }
    } else {
      oficial.valorImpostoSeletivo = '0.00';
    }
    return oficial;
  });

  const operacao = { id: novoIdOperacao(), versao: '3.0.0', data: dia, tpDoc, aliquotasEfetivas, itens };
  if (nfse) { operacao.opSimpNac = '3'; operacao.regApIBSCBSSN = '1'; operacao.regApTribSN = '1'; }
  else { operacao.CRT = '1'; }
  return operacao;
}

export function traduzirSimples(resp, entrada) {
  const objetos = Array.isArray(resp?.objetos) ? resp.objetos : [];
  const itens = objetos.map((o) => {
    const idx = (o.nObj ?? 0) - 1;
    const sit = situacao(o.estadoItem);
    const t = o.tribCalc;
    const cbs = num(t?.vCBSSN);
    const ibs = num(t?.vIBSSN);
    const is = num(t?.IS?.valor);
    return {
      numero: o.nObj,
      descricao: entrada?.itens?.[idx]?.descricao || `Item ${o.nObj}`,
      situacao: sit.chave,
      situacaoTexto: sit.texto,
      base: num(t?.vBC),
      cbs,
      ibs,
      impostoSeletivo: is,
      aliquotaCbs: num(t?.pCBSSN),
      aliquotaIbs: num(t?.pIBSSN),
      tipoReceita: t?.tpRBSNDescricao ?? null,
      total: sit.chave === 'calculado' ? (num(t?.totalItem) ?? soma([cbs, ibs, is])) : null,
      mensagens: [
        ...mensagensErro(o.erros),
        ...(o.motivoEstado?.descricao ? [o.motivoEstado.descricao] : []),
      ],
    };
  });
  const calc = itens.filter((i) => i.situacao === 'calculado');
  const totais = {
    base: num(resp?.total?.vBC) ?? soma(calc.map((i) => i.base)),
    cbs: num(resp?.total?.vCBSSNtot) ?? soma(calc.map((i) => i.cbs)),
    ibs: num(resp?.total?.vIBSSNtot) ?? soma(calc.map((i) => i.ibs)),
    impostoSeletivo: num(resp?.total?.totalIs) ?? soma(calc.map((i) => i.impostoSeletivo)),
  };
  totais.total = num(resp?.total?.totalTributos) ?? soma([totais.cbs, totais.ibs, totais.impostoSeletivo]);
  const avisos = [...(resp?.resolucaoAliquotas?.avisos ?? [])];
  if (itens.some((i) => i.situacao !== 'calculado')) {
    avisos.push('Alguns itens não foram calculados. Corrija os dados indicados e simule novamente.');
  }
  return { itens, totais, avisos };
}

// Erros devolvidos pelas calculadoras (RFC 9457) viram uma frase para a tela.
export function mensagemDeErroOficial(corpo) {
  try {
    const j = JSON.parse(corpo.toString('utf8'));
    const lista = Array.isArray(j.erros) ? j.erros : Array.isArray(j.errors) ? j.errors : [];
    const detalhes = lista.map((e) => e.detail || e.title).filter(Boolean);
    if (detalhes.length) return detalhes.join(' · ');
    return j.detail || j.title || null;
  } catch {
    return null;
  }
}
