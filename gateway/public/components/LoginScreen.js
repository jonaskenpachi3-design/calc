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
    this.modoCadastro = false;
  }

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

    // Event listeners
    document.getElementById('a-trocar').onclick = () => {
      this.modoCadastro = !this.modoCadastro;
      aviso('a-msg');
      this.atualizarFormulario();
    };

    document.getElementById('a-enviar').onclick = async () => {
      const btn = document.getElementById('a-enviar');
      btn.disabled = true;
      try {
        const emailEl = document.getElementById('a-email');
        const senhaEl = document.getElementById('a-senha');
        if (!emailEl || !senhaEl) {
          throw new Error('Campos do formulário não encontrados. Tente recarregar a página.');
        }
        const corpo = {
          email: emailEl.value,
          senha: senhaEl.value
        };
        if (this.modoCadastro) {
          const nomeEl = document.getElementById('a-nome');
          if (nomeEl) corpo.nome = nomeEl.value;
        }
        const r = await this.api.post(this.modoCadastro ? '/auth/register' : '/auth/login', corpo);
        this.state.setToken(r.token);
        if (senhaEl) senhaEl.value = '';
        aviso('a-msg');
        this.router.navigate('dashboard'); // Vai para seletor de empresas
      } catch (e) {
        aviso('a-msg', e.message, 'err');
      }
      btn.disabled = false;
    };
  }

  atualizarFormulario() {
    const titulo = document.getElementById('entrar-titulo');
    const campoNome = document.getElementById('campo-nome');
    const btnEnviar = document.getElementById('a-enviar');
    const btnTrocar = document.getElementById('a-trocar');
    const eyebrow = document.getElementById('entrar-eyebrow');

    titulo.textContent = this.modoCadastro ? 'Criar conta gratuita' : 'Entrar';
    campoNome.style.display = this.modoCadastro ? 'block' : 'none';
    btnEnviar.textContent = this.modoCadastro ? 'Criar conta' : 'Entrar';
    btnTrocar.textContent = this.modoCadastro ? 'Já tenho conta' : 'Ainda não tenho conta';
    eyebrow.textContent = this.modoCadastro ? 'Comece agora' : 'Bem-vindo(a) de volta';

    // Renderizar campo nome se cadastro
    if (this.modoCadastro) {
      campoNome.innerHTML = '';
      campoNome.append(el('label', { for: 'a-nome' }, 'Nome da empresa'),
        el('input', { id: 'a-nome', autocomplete: 'organization' }));
    } else {
      campoNome.innerHTML = '';
    }

    // Renderizar campos email/senha
    const emailDiv = document.getElementById('campo-email');
    emailDiv.innerHTML = '';
    emailDiv.append(el('label', { for: 'a-email' }, 'E-mail'),
      el('input', { id: 'a-email', type: 'email', autocomplete: 'email', placeholder: 'voce@empresa.com.br' }));

    const senhaDiv = document.getElementById('campo-senha');
    senhaDiv.innerHTML = '';
    senhaDiv.append(el('label', { for: 'a-senha' }, 'Senha ',
      el('span', { class: 'hint' }, 'Mínimo de 10 caracteres')),
      el('input', { id: 'a-senha', type: 'password', autocomplete: this.modoCadastro ? 'new-password' : 'current-password' }));
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