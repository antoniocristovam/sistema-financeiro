export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Envio de e-mail.
 *
 * Em desenvolvimento o destino e' o Mailpit; em producao, um SMTP de verdade.
 * O caso de uso nao sabe a diferenca.
 */
export interface MailService {
  send(input: SendMailInput): Promise<void>;
}

export const MAIL_SERVICE = Symbol('MailService');
