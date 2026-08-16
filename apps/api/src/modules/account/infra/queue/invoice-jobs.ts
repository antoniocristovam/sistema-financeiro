import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';

import { type Env } from '../../../../config/env';
import { CLOCK, type Clock } from '../../../../shared/application/ports/clock';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import {
  CloseInvoicesUseCase,
  SendInvoiceRemindersUseCase,
} from '../../core/application/use-cases/manage-invoices';

export const INVOICE_QUEUE = 'invoices';
export const CLOSE_JOB = 'close';
export const DUE_REMINDER_JOB = 'due-reminder';

/**
 * Worker das faturas.
 *
 * Mesma forma do worker das contas fixas: o processador so traduz um job em
 * uma chamada de caso de uso, e "hoje" e' resolvido aqui, no fuso da
 * aplicacao. Uma fatura fechada um dia antes ou depois muda a competencia de
 * todas as compras daquele dia.
 */
@Processor(INVOICE_QUEUE)
export class InvoiceProcessor extends WorkerHost {
  private readonly logger = new Logger(InvoiceProcessor.name);

  constructor(
    private readonly closeInvoices: CloseInvoicesUseCase,
    private readonly remind: SendInvoiceRemindersUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const today = CalendarDate.todayIn(
      this.clock.now(),
      this.config.get('APP_TIMEZONE', { infer: true }),
    );

    switch (job.name) {
      case CLOSE_JOB: {
        const report = await this.closeInvoices.execute(today);

        this.logger.log(`Fechamento ${today.toString()}: ${report.invoicesClosed} faturas.`);

        return report;
      }

      case DUE_REMINDER_JOB: {
        const report = await this.remind.execute(today);

        this.logger.log(
          `Vencimentos ${today.toString()}: ${report.notificationsCreated} avisos.`,
        );

        return report;
      }

      default:
        throw new Error(`Job desconhecido na fila de faturas: ${job.name}`);
    }
  }
}

/**
 * Agenda o fechamento e o lembrete de vencimento.
 *
 * `jobId` fixo pelo mesmo motivo das contas fixas: sem ele, cada reinicio da
 * API somaria mais uma agenda.
 */
@Injectable()
export class InvoiceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(InvoiceScheduler.name);

  constructor(
    @InjectQueue(INVOICE_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const tz = this.config.get('APP_TIMEZONE', { infer: true });

    try {
      await this.queue.add(
        CLOSE_JOB,
        {},
        {
          repeat: { pattern: this.config.get('INVOICE_CLOSING_CRON', { infer: true }), tz },
          jobId: 'invoices:close:daily',
        },
      );

      await this.queue.add(
        DUE_REMINDER_JOB,
        {},
        {
          repeat: { pattern: this.config.get('INVOICE_REMINDER_CRON', { infer: true }), tz },
          jobId: 'invoices:due-reminder:daily',
        },
      );

      this.logger.log(`Fechamento de faturas agendado no fuso ${tz}.`);
    } catch (error) {
      // Redis fora do ar degrada o fechamento, nao derruba a API.
      this.logger.error(
        'Nao foi possivel agendar os jobs de fatura; a API sobe assim mesmo.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
