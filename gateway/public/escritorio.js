/** Dados do escritório (nome, responsável, CRC, contato, cor, logotipo): guardados no servidor, saem nos relatórios. */
export async function carregarEscritorio(api) { try { return (await api.get('/me/escritorio')) || {}; } catch { return {}; } }
export const salvarEscritorio = (api, dados) => api.put('/me/escritorio', dados);

/** Reduz a imagem para caber no relatório (até 400×160) e devolve data URL PNG/JPEG abaixo de ~280 KB. */
export function reduzirLogo(arquivo) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) return reject(new Error('Use uma imagem PNG, JPG ou WebP.'));
    const leitor = new FileReader(); const img = new Image();
    leitor.onerror = () => reject(new Error('Não foi possível ler essa imagem.'));
    leitor.onload = () => { img.src = leitor.result; };
    img.onload = () => {
      const k = Math.min(1, 400 / img.width, 160 / img.height); const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
      let saida = c.toDataURL('image/png');
      if (saida.length > 280000) { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); saida = c.toDataURL('image/jpeg', 0.85); }
      saida.length > 280000 ? reject(new Error('A imagem ficou grande demais. Use uma logo mais simples.')) : resolve(saida);
    };
    img.onerror = () => reject(new Error('Não foi possível ler essa imagem.'));
    leitor.readAsDataURL(arquivo);
  });
}
