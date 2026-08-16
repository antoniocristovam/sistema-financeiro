import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

import { type MailService, type SendMailInput } from '../application/ports/mail-service';
import { type Env } from '../../config/env';

/**
 * Envio por SMTP. Em desenvolvimento o destino e' o Mailpit (localhost:1025).
 *
 * Falha de envio NAO derruba o caso de uso: um SMTP fora do ar nao pode
 * impedir alguem de se cadastrar. O usuario consegue pedir outro e-mail; o
 * cadastro perdido nao volta.
 */
@Injectable()
export class NodemailerMailService implements MailService, OnModuleDestroy {
  private readonly logger = new Logger(NodemailerMailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASSWORD', { infer: true });

    this.from = config.get('MAIL_FROM', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      // O Mailpit aceita conexao sem autenticacao.
      auth: user ? { user, pass } : undefined,
    });
  }

  async send(input: SendMailInput): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });

      return true;
    } catch (error) {
      this.logger.error(
        `Falha ao enviar e-mail para ${input.to} ("${input.subject}")`,
        error instanceof Error ? error.stack : String(error),
      );

      return false;
    }
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
