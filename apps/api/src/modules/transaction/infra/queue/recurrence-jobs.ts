import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';

import { type Env } from '../../../../config/env';
import { CLOCK, type Clock } from '../../../../shared/application/ports/clock';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { Inject } from '@nestjs/common';
import {
  MaterializeRecurrencesUseCase,
  SendRecurrenceRemindersUseCase,
} from '../../core/application/use-cases/run-recurrence-jobs';

export const RECURRENCE_QUEUE = 'recurrences';
export const MATERIALIZE_JOB = 'materialize';
export const REMIND_JOB = 'remind';

/**
 * O worker das contas fixas.
 *
 * A camada de aplicacao nao sabe que existe fila: o processador so traduz um
 * job em uma chamada de caso de uso. E' o que permite disparar a mesma rotina
 * de um teste de integracao, de um comando de manutencao ou de um endpoint
 * administrativo sem duplicar regra nenhuma.
 *
 * "Hoje" e' resolvido AQUI, no fuso da aplicacao, e passado adiante. Deixar o
 * caso de uso perguntar ao relogio faria a janela de materializacao depender do
 * fuso do servidor -- em UTC, uma execucao noturna cairia no dia seguinte.
 */
@Processor(RECURRENCE_QUEUE)
export class RecurrenceProcessor extends WorkerHost {
  private readonly logger = new Logger(RecurrenceProcessor.name);

  constructor(
    private readonly materialize: MaterializeRecurrencesUseCase,
    private readonly remind: SendRecurrenceRemindersUseCase,
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
      case MATERIALIZE_JOB: {
        const report = await this.materialize.execute(today);

        this.logger.log(
          `Materializacao ${today.toString()}: ${report.transactionsCreated} criados, ` +
            `${report.duplicatesSkipped} ja existiam, ${report.recurrencesProcessed} series.`,
        );

        return report;
      }

      case REMIND_JOB: {
        const report = await this.remind.execute(today);

        this.logger.log(
          `Lembretes ${today.toString()}: ${report.notificationsCreated} avisos, ` +
            `${report.emailsSent} e-mails, ${report.driftAlerts} reajustes.`,
        );

        return report;
      }

      default:
        throw new Error(`Job desconhecido na fila de recorrencias: ${job.name}`);
    }
  }
}

/**
 * Agenda os jobs diarios.
 *
 * O `jobId` fixo e' o detalhe que importa: sem ele, cada reinicio da API
 * registraria mais uma agenda, e depois de dez deploys a materializacao rodaria
 * dez vezes por madrugada. Com ele, registrar de novo apenas sobrescreve.
 *
 * Os dois jobs sao separados e o lembrete roda DEPOIS: ele avisa sobre
 * ocorrencias que a materializacao acabou de criar.
 */
@Injectable()
export class RecurrenceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecurrenceScheduler.name);

  constructor(
    @InjectQueue(RECURRENCE_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const timezone = this.config.get('APP_TIMEZONE', { infer: true });

    try {
      await this.queue.add(
        MATERIALIZE_JOB,
        {},
        {
          repeat: { pattern: this.config.get('RECURRENCE_CRON', { infer: true }), tz: timezone },
          jobId: 'recurrences:materialize:daily',
        },
      );

      await this.queue.add(
        REMIND_JOB,
        {},
        {
          repeat: { pattern: this.config.get('REMINDER_CRON', { infer: true }), tz: timezone },
          jobId: 'recurrences:remind:daily',
        },
      );

      this.logger.log(`Jobs diarios agendados no fuso ${timezone}.`);
    } catch (error) {
      /*
       * Redis fora do ar nao pode impedir a API de subir.
       *
       * Sem isto, uma indisponibilidade do Redis derrubaria tambem o extrato, o
       * cadastro e o login -- trocando uma degradacao (a conta fixa aparece
       * amanha) por uma queda total.
       */
      this.logger.error(
        'Nao foi possivel agendar os jobs diarios; a API sobe assim mesmo.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
