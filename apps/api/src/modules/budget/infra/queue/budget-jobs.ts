import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';

import { type Env } from '../../../../config/env';
import { CLOCK, type Clock } from '../../../../shared/application/ports/clock';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { MonthReference } from '../../../../shared/domain/value-objects/month-reference';
import { CheckBudgetAlertsUseCase } from '../../core/application/use-cases/manage-budgets';

export const BUDGET_QUEUE = 'budgets';
export const CHECK_ALERTS_JOB = 'check-alerts';

/**
 * Worker dos alertas de orcamento.
 *
 * Roda algumas vezes por dia, e nao a cada lancamento: a regra e' "uma vez por
 * limiar, por mes", entao avisar meia hora depois de a pessoa cruzar os 80% e'
 * indistinguivel de avisar na hora -- e custa uma fracao do trabalho.
 */
@Processor(BUDGET_QUEUE)
export class BudgetProcessor extends WorkerHost {
  private readonly logger = new Logger(BudgetProcessor.name);

  constructor(
    private readonly checkAlerts: CheckBudgetAlertsUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== CHECK_ALERTS_JOB) {
      throw new Error(`Job desconhecido na fila de orcamentos: ${job.name}`);
    }

    const today = CalendarDate.todayIn(
      this.clock.now(),
      this.config.get('APP_TIMEZONE', { infer: true }),
    );

    const report = await this.checkAlerts.execute(MonthReference.fromDate(today));

    this.logger.log(
      `Orcamentos ${today.toMonthKey()}: ${report.budgetsChecked} conferidos, ` +
        `${report.notificationsCreated} avisos.`,
    );

    return report;
  }
}

/**
 * Agenda a conferencia dos orcamentos.
 *
 * `jobId` fixo pelo mesmo motivo dos outros agendadores: sem ele, cada reinicio
 * da API somaria mais uma agenda.
 */
@Injectable()
export class BudgetScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(BudgetScheduler.name);

  constructor(
    @InjectQueue(BUDGET_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const tz = this.config.get('APP_TIMEZONE', { infer: true });

    try {
      await this.queue.add(
        CHECK_ALERTS_JOB,
        {},
        {
          repeat: { pattern: this.config.get('BUDGET_ALERT_CRON', { infer: true }), tz },
          jobId: 'budgets:check-alerts',
        },
      );

      this.logger.log(`Alertas de orcamento agendados no fuso ${tz}.`);
    } catch (error) {
      this.logger.error(
        'Nao foi possivel agendar os alertas de orcamento; a API sobe assim mesmo.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
