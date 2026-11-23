/**
 * Nexo Fiscal — LoginScreen Component
 * ==========================================================================
 * Tela de acesso (visitante): login, cadastro, planos.
 */

import { el, limpar, aviso, campo, dinheiro, formatCNPJ } from '../utils.js';

export class LoginScreen {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
    this.modo = 'login'; // login | cadastro | esqueci | redefinir
    this.tokenRedef = null;
    // Link de redefinição (#/redefinir?token=...): o token sai da barra de endereço assim que é lido.
    const m = /^#\/redefinir\?token=([\w-]+)/.exec(window.location.hash);
    if (m) { this.modo = 'redefinir'; this.tokenRedef = m[1]; window.history.replaceState(null, '', window.location.pathname + window.location.search); }
  }

  get modoCadastro() { return this.modo === 'cadastro'; }

  render() {
    const section = el('section', { id: 'visitante' });
    section.innerHTML = `
      <div class="page">
        <div class="card login-wrap">
          <div class="login-art">
            <div>
              <div class="brand">
                <div class="brand-mark">N</div>
                <div>
                  <div class="brand-name">nexo fiscal</div>
                  <div class="brand-sub">simulador CBS e IBS</div>
                </div>
              </div>
              <h2>Descubra quanto vai pagar de CBS e IBS antes de emitir a nota.</h2>
              <p>Preencha os dados da venda ou do serviço e veja o valor dos novos tributos da Reforma Tributária, item por item, com o mesmo motor de cálculo publicado pela Receita Federal.</p>
              <ul class="benefits">
                <li>Sem planilhas e sem termos técnicos: você preenche um formulário.</li>
                <li>Para empresas do regime normal e do Simples Nacional.</li>
                <li>PDF (DANFSe) da nota de serviço a partir do XML.</li>
                <li>Histórico das suas simulações.</li>
              </ul>
            </div>
            <div class="login-foot">Resultado informativo · baseado nas calculadoras da Receita Federal</div>
          </div>
          <div class="login-form" id="entrar-card">
            <div class="eyebrow" id="entrar-eyebrow">Bem-vindo(a) de volta</div>
            <h2 id="entrar-titulo">Entrar</h2>
            <div id="campo-nome" style="margin-bottom:14px; display:none;"></div>
            <div id="campo-email" style="margin-bottom:14px"></div>
            <div id="campo-senha" style="margin-bottom:16px"></div>
            <div class="row">
              <button id="a-enviar">Entrar</button>
              <button class="link" id="a-trocar">Ainda não tenho conta</button>
              <button class="link" id="a-esqueci">Esqueci minha senha</button>
            </div>
            <div id="a-msg" role="alert"></div>
          </div>
        </div>
        <h2>Planos</h2>
        <div class="plans" id="planos"></div>
        <p class="mut small" style="padding-bottom:28px">As simulações usam as calculadoras publicadas pela Receita Federal e têm caráter informativo: não substituem a orientação do seu contador nem a apuração oficial dos tributos.</p>
      </div>
    `;

    return section;
  }

  mount() {
    this.atualizarFormulario();
    this.carregarPlanos();

    document.getElementById('a-trocar').onclick = () => {
      this.modo = this.modo === 'login' ? 'cadastro' : 'login';
      this.tokenRedef = null;
      aviso('a-msg');
      this.atualizarFormulario();
    };
    document.getElementById('a-esqueci').onclick = () => { this.modo = 'esqueci'; aviso('a-msg'); this.atualizarFormulario(); };

    document.getElementById('a-enviar').onclick = async () => {
      const btn = document.getElementById('a-enviar');
      btn.disabled = true;
      try {
        const valor = (id) => document.getElementById(id)?.value ?? '';
        if (this.modo === 'esqueci') {
          const r = await this.api.post('/auth/esqueci', { email: valor('a-email') });
          aviso('a-msg', r.mensagem, 'ok');
        } else if (this.modo === 'redefinir') {
          if (valor('a-senha') !== valor('a-senha2')) throw new Error('As duas senhas precisam ser iguais.');
          const r = await this.api.post('/auth/redefinir', { token: this.tokenRedef, senha: valor('a-senha') });
          this.state.setToken(null); // a troca derruba qualquer sessão aberta
          this.modo = 'login'; this.tokenRedef = null;
          this.atualizarFormulario();
          aviso('a-msg', r.mensagem, 'ok');
        } else {
          const corpo = { email: valor('a-email'), senha: valor('a-senha') };
          if (this.modo === 'cadastro') corpo.nome = valor('a-nome');
          const r = await this.api.post(this.modo === 'cadastro' ? '/auth/register' : '/auth/login', corpo);
          this.state.setToken(r.token);
          aviso('a-msg');
          this.router.navigate('dashboard'); // Vai para seletor de empresas
        }
      } catch (e) {
        aviso('a-msg', e.message, 'err');
      }
      btn.disabled = false;
    };
  }

  atualizarFormulario() {
    const m = this.modo;
    const textos = {
      login: ['Bem-vindo(a) de volta', 'Entrar', 'Entrar', 'Ainda não tenho conta'],
      cadastro: ['Comece agora', 'Criar conta gratuita', 'Criar conta', 'Já tenho conta'],
      esqueci: ['Esqueceu a senha?', 'Recuperar senha', 'Enviar instruções', 'Voltar para entrar'],
      redefinir: ['Quase lá', 'Criar nova senha', 'Salvar nova senha', 'Cancelar'],
    }[m];
    document.getElementById('entrar-eyebrow').textContent = textos[0];
    document.getElementById('entrar-titulo').textContent = textos[1];
    document.getElementById('a-enviar').textContent = textos[2];
    document.getElementById('a-trocar').textContent = textos[3];
    document.getElementById('a-esqueci').style.display = m === 'login' ? '' : 'none';

    const campoNome = document.getElementById('campo-nome');
    campoNome.innerHTML = '';
    campoNome.style.display = m === 'cadastro' ? 'block' : 'none';
    if (m === 'cadastro') campoNome.append(el('label', { for: 'a-nome' }, 'Nome da empresa'), el('input', { id: 'a-nome', autocomplete: 'organization' }));

    const emailDiv = document.getElementById('campo-email');
    emailDiv.innerHTML = '';
    emailDiv.style.display = m === 'redefinir' ? 'none' : '';
    if (m !== 'redefinir') emailDiv.append(el('label', { for: 'a-email' }, 'E-mail'), el('input', { id: 'a-email', type: 'email', autocomplete: 'email', placeholder: 'voce@empresa.com.br' }));

    const senhaDiv = document.getElementById('campo-senha');
    senhaDiv.innerHTML = '';
    senhaDiv.style.display = m === 'esqueci' ? 'none' : '';
    if (m !== 'esqueci') {
      senhaDiv.append(el('label', { for: 'a-senha' }, m === 'redefinir' ? 'Nova senha ' : 'Senha ', el('span', { class: 'hint' }, 'Mínimo de 10 caracteres')),
        el('input', { id: 'a-senha', type: 'password', autocomplete: m === 'login' ? 'current-password' : 'new-password' }));
      if (m === 'redefinir') senhaDiv.append(el('label', { for: 'a-senha2', style: 'margin-top:10px;display:block' }, 'Repita a nova senha'), el('input', { id: 'a-senha2', type: 'password', autocomplete: 'new-password' }));
    }
  }

  async carregarPlanos() {
    try {
      const { planos } = await this.api.get('/planos');
      const alvo = document.getElementById('planos');
      limpar(alvo);
      const nomes = { gratuito: 'Gratuito', profissional: 'Profissional', ilimitado: 'Ilimitado' };
      for (const [chave, lim] of Object.entries(planos)) {
        alvo.append(el('div', { class: 'card plan' },
          el('h3', {}, nomes[chave] || chave),
          el('ul', {},
            el('li', {}, lim.calculo === null ? 'Simulações sem limite' : `${lim.calculo.toLocaleString('pt-BR')} simulações por mês`),
            el('li', {}, lim.danfse === null ? 'PDFs de nota sem limite' : `${lim.danfse.toLocaleString('pt-BR')} PDFs de nota por mês`)
          )));
      }
    } catch (e) {
      console.warn('Falha ao carregar planos:', e);
    }
  }

  unmount() {
    // Limpeza se necessário
  }
}