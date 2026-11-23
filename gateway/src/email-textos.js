/** Textos dos e-mails enviados pelo sistema (português). */
const validade = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export function textoDoEmail(corpo, app = 'Nexo Fiscal') {
  if (corpo.tipo === 'redefinicao_de_senha') {
    return {
      assunto: `${app}: criar nova senha`,
      texto: [
        'Olá,', '',
        `Recebemos um pedido para criar uma nova senha no ${app}. Abra o link abaixo para escolher a nova senha:`, '',
        corpo.link, '',
        `O link vale até ${validade(corpo.expira_em)} (horário de Brasília) e só pode ser usado uma vez.`,
        'Se você não pediu isso, ignore esta mensagem: sua senha continua a mesma.', '',
        app,
      ].join('\n'),
    };
  }
  if (corpo.tipo === 'confirmacao_de_email') {
    return {
      assunto: `${app}: confirme seu e-mail`,
      texto: [
        'Olá,', '',
        `Para confirmar seu e-mail no ${app}, abra o link abaixo:`, '',
        corpo.link, '',
        `O link vale até ${validade(corpo.expira_em)} (horário de Brasília) e só pode ser usado uma vez.`,
        'Se você não criou uma conta, ignore esta mensagem.', '',
        app,
      ].join('\n'),
    };
  }
  return null;
}
