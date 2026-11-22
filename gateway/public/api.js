/**
 * Nexo Fiscal — API Client
 * ==========================================================================
 * Camada de comunicação com o backend gateway.
 */

export class API {
  constructor(state) {
    this.state = state;
  }

  getToken() {
    return this.state.token;
  }

  async request(path, options = {}) {
    const token = this.getToken();
    const headers = {
      'content-type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    };

    const res = await fetch(path, { ...options, headers });

    if (res.status === 401 && token) {
      this.state.clearToken();
      window.location.hash = '#/login';
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data?.erro?.mensagem || `Erro ${res.status}`);
    }

    return data;
  }

  get(path) {
    return this.request(path, { method: 'GET' });
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put(path, body) {
    return this.request(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }

  // Upload de arquivos
  async upload(path, formData) {
    const token = this.getToken();
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: formData
    });

    if (res.status === 401 && token) {
      this.state.clearToken();
      window.location.hash = '#/login';
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.erro?.mensagem || `Erro ${res.status}`);
    }
    return data;
  }

  // Download de arquivos (blob)
  async download(path, options = {}) {
    const token = this.getToken();
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    });

    if (res.status === 401 && token) {
      this.state.clearToken();
      window.location.hash = '#/login';
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.erro?.mensagem || `Erro ${res.status}`);
    }

    return res.blob();
  }
}