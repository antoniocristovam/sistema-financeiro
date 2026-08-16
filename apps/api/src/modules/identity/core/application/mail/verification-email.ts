import { type SendMailInput } from '../../../../../shared/application/ports/mail-service';

/**
 * Templates de e-mail da identidade.
 *
 * Ficam em `core/application` porque o CONTEUDO e' regra de negocio (o que o
 * usuario le, qual link recebe). O ENVIO e' porta -- quem entrega e' a infra.
 *
 * HTML propositalmente simples: cliente de e-mail nao renderiza CSS moderno, e
 * o objetivo aqui e' o link chegar clicavel.
 */

interface EmailParams {
  name: string;
  to: string;
  token: string;
  webUrl: string;
}

function layout(title: string, body: string, ctaLabel: string, ctaUrl: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2430">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
          <tr><td>
            <p style="margin:0 0 4px;font-size:13px;letter-spacing:1px;color:#5b6bd6;text-transform:uppercase">finapp</p>
            <h1 style="margin:0 0 16px;font-size:20px">${title}</h1>
            ${body}
            <p style="margin:28px 0">
              <a href="${ctaUrl}" style="display:inline-block;background:#5b6bd6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${ctaLabel}</a>
            </p>
            <p style="margin:0;font-size:13px;color:#6b7280">
              Se o botao nao funcionar, copie este endereco no navegador:<br />
              <span style="word-break:break-all">${ctaUrl}</span>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildVerificationEmail(params: EmailParams): SendMailInput {
  const url = `${params.webUrl}/verificar-email?token=${encodeURIComponent(params.token)}`;

  return {
    to: params.to,
    subject: 'Confirme seu e-mail no finapp',
    html: layout(
      `Bem-vindo, ${escapeHtml(params.name)}`,
      '<p style="margin:0;font-size:15px;line-height:1.6">Falta um passo para sua conta ficar pronta: confirme que este e-mail e seu. O link vale por 24 horas.</p>',
      'Confirmar e-mail',
      url,
    ),
    text: `Bem-vindo, ${params.name}.\n\nConfirme seu e-mail no finapp acessando:\n${url}\n\nO link vale por 24 horas.`,
  };
}

export function buildPasswordResetEmail(params: EmailParams): SendMailInput {
  const url = `${params.webUrl}/redefinir-senha?token=${encodeURIComponent(params.token)}`;

  return {
    to: params.to,
    subject: 'Redefinicao de senha no finapp',
    html: layout(
      'Redefinir senha',
      '<p style="margin:0;font-size:15px;line-height:1.6">Recebemos um pedido para redefinir sua senha. O link vale por 30 minutos.<br /><br />Se nao foi voce, ignore este e-mail: sua senha continua a mesma.</p>',
      'Criar nova senha',
      url,
    ),
    text: `Recebemos um pedido para redefinir sua senha no finapp.\n\nAcesse:\n${url}\n\nO link vale por 30 minutos. Se nao foi voce, ignore este e-mail.`,
  };
}

export function buildInvitationEmail(params: {
  to: string;
  token: string;
  webUrl: string;
  workspaceName: string;
  invitedByName: string;
  roleLabel: string;
}): SendMailInput {
  const url = `${params.webUrl}/convite?token=${encodeURIComponent(params.token)}`;

  return {
    to: params.to,
    subject: `${params.invitedByName} convidou voce para "${params.workspaceName}" no finapp`,
    html: layout(
      'Voce foi convidado',
      `<p style="margin:0;font-size:15px;line-height:1.6"><strong>${escapeHtml(params.invitedByName)}</strong> convidou voce para participar de <strong>${escapeHtml(params.workspaceName)}</strong> como <strong>${escapeHtml(params.roleLabel)}</strong>.<br /><br />O convite vale por 7 dias.</p>`,
      'Aceitar convite',
      url,
    ),
    text: `${params.invitedByName} convidou voce para "${params.workspaceName}" no finapp como ${params.roleLabel}.\n\nAcesse:\n${url}\n\nO convite vale por 7 dias.`,
  };
}

/** Nome de usuario e nome de workspace vem do usuario: escapar e' obrigatorio. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
