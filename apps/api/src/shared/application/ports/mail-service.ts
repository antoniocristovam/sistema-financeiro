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
 *
 * `send` devolve SE o servidor aceitou a mensagem. A implementacao engole a
 * falha de proposito -- SMTP fora do ar nao pode impedir alguem de se cadastrar
 * -- e sem esse retorno quem chama nao teria como distinguir "enviado" de
 * "falhou em silencio". O job diario relatava e-mails que nunca sairam.
 */
export interface MailService {
  send(input: SendMailInput): Promise<boolean>;
}

export const MAIL_SERVICE = Symbol('MailService');
