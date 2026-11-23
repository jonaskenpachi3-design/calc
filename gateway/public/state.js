/**
 * Nexo Fiscal — State Management
 * ==========================================================================
 * Estado global da aplicação: token, usuário, empresa ativa, abas, cache.
 */

export class State {
  constructor() {
    this.token = null;
    this.user = null;
    this.empresas = [];
    this.empresaAtiva = null;
    this.abaAtiva = 'dashboard';
    this.cache = new Map();
    this.listeners = new Set();
  }

  // ---- Token & Auth ----

  setToken(token) {
    this.token = token;
    if (token) {
      sessionStorage.setItem('rtc_token', token);
    } else {
      sessionStorage.removeItem('rtc_token');
    }
    this.emit('auth:change');
  }

  clearToken() {
    this.token = null;
    this.user = null;
    this.empresas = [];
    this.empresaAtiva = null;
    sessionStorage.removeItem('rtc_token');
    this.emit('auth:change');
  }

  async loadUser() {
    if (!this.token) return null;
    try {
      this.user = await this.apiGet('/me');
      this.emit('user:change');
      return this.user;
    } catch (e) {
      this.clearToken();
      throw e;
    }
  }

  // ---- Empresas ----

  async loadEmpresas() {
    if (!this.token) return [];
    try {
      const data = await this.apiGet('/empresas');
      this.empresas = data.empresas || [];
      this.emit('empresas:change');
      return this.empresas;
    } catch (e) {
      console.error('Erro ao carregar empresas:', e);
      this.empresas = [];
      throw e;
    }
  }

  setEmpresaAtiva(cnpj) {
    if (!cnpj) {
      this.empresaAtiva = null;
    } else {
      this.empresaAtiva = this.empresas.find(e => e.cnpj === cnpj) || null;
    }
    sessionStorage.setItem('rtc_empresa_ativa', cnpj || '');
    this.emit('empresa:change');
  }

  getEmpresaAtiva() {
    return this.empresaAtiva;
  }

  async createEmpresa(dados) {
    const nova = await this.apiPost('/empresas', dados);
    this.empresas.push(nova);
    this.emit('empresas:change');
    return nova;
  }

  async deleteEmpresa(cnpj) {
    await this.apiPost('/empresas/delete', { cnpj });
    this.empresas = this.empresas.filter(e => e.cnpj !== cnpj);
    // Se a empresa deletada era a ativa, limpar empresa ativa
    if (this.empresaAtiva?.cnpj === cnpj) {
      this.setEmpresaAtiva(null);
    }
    this.emit('empresas:change');
  }

  // ---- Abas ----

  setAba(aba) {
    this.abaAtiva = aba;
    this.emit('aba:change', aba);
  }

  // ---- Cache ----

  cacheGet(key) {
    return this.cache.get(key);
  }

  cacheSet(key, value) {
    this.cache.set(key, value);
  }

  cacheClear() {
    this.cache.clear();
  }

  // ---- API Helpers ----

  async apiGet(path) {
    const res = await fetch(path, {
      headers: { authorization: `Bearer ${this.token}` }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.erro?.mensagem || `Erro ${res.status}`);
    }
    return res.json();
  }

  async apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.erro?.mensagem || `Erro ${res.status}`);
    }
    return res.json();
  }

  // ---- Eventos ----

  on(event, callback) {
    // O ouvinte já é específico do evento (app:<evento>); comparar o objeto do evento com o nome nunca era verdadeiro.
    const wrapper = (e) => callback(e.detail);
    window.addEventListener(`app:${event}`, wrapper);
    this.listeners.add({ event, wrapper });
    return () => this.off(event, callback);
  }

  off(event, callback) {
    for (const l of this.listeners) {
      if (l.event === event) {
        window.removeEventListener(`app:${event}`, l.wrapper);
        this.listeners.delete(l);
      }
    }
  }

  emit(event, detail) {
    window.dispatchEvent(new CustomEvent(`app:${event}`, { detail }));
  }
}