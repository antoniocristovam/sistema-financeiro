import { NotificationType, notificationDedupeKey, TransactionStatus } from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type MailService } from '../../../../../shared/application/ports/mail-service';
import {
  type NotificationRequest,
  type Notifier,
} from '../../../../../shared/application/ports/notifier';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type UserRepository } from '../../../../identity/core/domain/repositories/user-repository';
import { type WorkspaceRepository } from '../../../../workspace/core/domain/repositories/workspace-repository';
import { Transaction } from '../../domain/entities/transaction';
import { type Recurrence } from '../../domain/entities/recurrence';
import { type RecurrenceRepository } from '../../domain/repositories/recurrence-repository';
import { type TransactionRepository } from '../../domain/repositories/transaction-repository';

/** Quantas series o job carrega por vez. */
const BATCH_SIZE = 200;

/** Quantos pagamentos anteriores entram na media do reajuste. */
const DRIFT_HISTORY_SIZE = 6;

export interface MaterializationReport {
  recurrencesProcessed: number;
  transactionsCreated: number;
  /** Ja existiam. Numero alto aqui e' sinal de reexecucao, nao de erro. */
  duplicatesSkipped: number;
}

/**
 * Materializa as ocorrencias das contas fixas.
 *
 * Roda uma vez por dia, sem usuario e sem workspace no contexto -- e' o unico
 * caminho do sistema que atravessa workspaces, e por isso ele nao autoriza
 * nada: ele nao age em nome de ninguem, apenas executa a regra que o dono do
 * workspace ja cadastrou.
 *
 * **Idempotencia** e' a propriedade que mais importa aqui, porque um job pode
 * ser reexecutado por retry, por deploy no meio da execucao ou por duas
 * instancias subindo juntas. Ela nao depende de nenhum controle em memoria: o
 * indice unico `(recurrenceId, occurrenceDate)` decide, e a segunda tentativa
 * de gravar a mesma ocorrencia volta como duplicata em vez de virar uma segunda
 * conta de luz no extrato do usuario.
 */
export class MaterializeRecurrencesUseCase {
  constructor(
    private readonly recurrences: RecurrenceRepository,
    private readonly transactions: TransactionRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(reference?: CalendarDate): Promise<MaterializationReport> {
    const today = reference ?? CalendarDate.fromUtcDate(this.clock.now());
    const report: MaterializationReport = {
      recurrencesProcessed: 0,
      transactionsCreated: 0,
      duplicatesSkipped: 0,
    };

    // Moeda por workspace, resolvida uma vez: o lote inteiro costuma cair em
    // poucos workspaces, e uma consulta por serie seria N+1 dentro do job.
    const currencies = new Map<string, string>();

    let afterId: string | undefined;

    for (;;) {
      const batch = await this.recurrences.findActiveForJob({
        limit: BATCH_SIZE,
        ...(afterId ? { afterId } : {}),
      });

      if (batch.length === 0) {
        break;
      }

      for (const recurrence of batch) {
        const workspaceKey = recurrence.workspaceId.toValue();

        if (!currencies.has(workspaceKey)) {
          const workspace = await this.workspaces.findById(recurrence.workspaceId);
          currencies.set(workspaceKey, workspace?.baseCurrency ?? 'BRL');
        }

        const created = await this.materialize(
          recurrence,
          today,
          currencies.get(workspaceKey)!,
          report,
        );

        report.recurrencesProcessed += 1;

        if (created) {
          await this.recurrences.save(recurrence);
        }
      }

      afterId = batch.at(-1)!.id.toValue();
    }

    return report;
  }

  private async materialize(
    recurrence: Recurrence,
    today: CalendarDate,
    currency: string,
    report: MaterializationReport,
  ): Promise<boolean> {
    const skips = await this.recurrences.skips(recurrence.id);
    const occurrences = recurrence.pendingOccurrences(today, skips);

    for (const occurrence of occurrences) {
      const transaction = Transaction.create({
        workspaceId: recurrence.workspaceId,
        accountId: recurrence.template.accountId,
        categoryId: recurrence.template.categoryId,
        createdByUserId: recurrence.createdByUserId,
        type: recurrence.template.type,
        amount: Money.fromCents(recurrence.template.amount.toCents(), currency),
        date: occurrence,
        description: recurrence.template.description,
        // Nasce PENDENTE: a conta ainda nao foi paga, e trata-la como liquidada
        // faria o saldo mostrar dinheiro que ainda esta na conta.
        status: TransactionStatus.PENDING,
        notes: recurrence.template.notes,
        recurrenceId: recurrence.id,
        occurrenceDate: occurrence,
      });

      if (transaction.isLeft()) {
        // Template invalido nao pode derrubar o lote inteiro: as outras series
        // seguem, e esta simplesmente nao gera nada ate ser corrigida.
        continue;
      }

      const inserted = await this.transactions.createIfAbsent(transaction.value);

      if (inserted) {
        report.transactionsCreated += 1;
      } else {
        report.duplicatesSkipped += 1;
      }
    }

    /*
     * A janela avanca mesmo quando nada foi criado.
     *
     * Sem isso, uma serie cujas ocorrencias foram todas dispensadas seria
     * reavaliada do zero todo dia -- e, pior, uma ocorrencia que o usuario
     * EXCLUIU voltaria na madrugada seguinte.
     */
    recurrence.markMaterializedUntil(today.addDays(60));

    return true;
  }
}

export interface ReminderReport {
  notificationsCreated: number;
  emailsSent: number;
  driftAlerts: number;
}

/**
 * Lembretes de conta a vencer e avisos de reajuste.
 *
 * Duas garantias sustentam este job:
 *
 * - **Uma vez por evento**: a chave de deduplicacao e' `tipo:serie:data`, entao
 *   reexecutar o job depois de uma falha nao manda o mesmo lembrete de novo.
 * - **E-mail so quando o aviso e' novo**: o retorno do `Notifier` decide. Sem
 *   isso a tela nao duplicaria nada, mas a caixa de entrada duplicaria.
 */
export class SendRecurrenceRemindersUseCase {
  constructor(
    private readonly recurrences: RecurrenceRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly users: UserRepository,
    private readonly notifier: Notifier,
    private readonly mail: MailService,
    private readonly clock: Clock,
    private readonly webUrl: string,
  ) {}

  async execute(reference?: CalendarDate): Promise<ReminderReport> {
    const today = reference ?? CalendarDate.fromUtcDate(this.clock.now());
    const report: ReminderReport = { notificationsCreated: 0, emailsSent: 0, driftAlerts: 0 };

    let afterId: string | undefined;

    for (;;) {
      const batch = await this.recurrences.findActiveForJob({
        limit: BATCH_SIZE,
        ...(afterId ? { afterId } : {}),
      });

      if (batch.length === 0) {
        break;
      }

      for (const recurrence of batch) {
        if (recurrence.reminderDaysBefore === null) {
          continue;
        }

        const target = today.addDays(recurrence.reminderDaysBefore);

        // A data precisa ser uma ocorrencia DE VERDADE da regra: somar os dias
        // de antecedencia a hoje nao garante que caia numa ocorrencia.
        const isOccurrence = recurrence.schedule
          .occurrencesBetween(target, target)
          .some((occurrence) => occurrence.equals(target));

        if (!isOccurrence || !recurrence.shouldRemindOn(today, target)) {
          continue;
        }

        const skips = await this.recurrences.skips(recurrence.id);

        if (skips.some((skip) => skip.equals(target))) {
          continue;
        }

        await this.remind(recurrence, target, report);
      }

      afterId = batch.at(-1)!.id.toValue();
    }

    return report;
  }

  private async remind(
    recurrence: Recurrence,
    occurrence: CalendarDate,
    report: ReminderReport,
  ): Promise<void> {
    const members = await this.workspaces.listMembers(recurrence.workspaceId);
    const userIds = members.map((member) => member.userId);
    const users = await this.users.findManyByIds(userIds);

    const amount = recurrence.template.amount;
    const days = recurrence.reminderDaysBefore ?? 0;
    const when = days === 0 ? 'hoje' : days === 1 ? 'amanha' : `em ${days} dias`;
    const value = formatMoney(amount, { locale: 'pt-BR' });

    const title = `${recurrence.name} vence ${when}`;
    const body =
      recurrence.template.type === 'EXPENSE'
        ? `${recurrence.template.description} de ${value} vence ${when} (${occurrence.toString()}).`
        : `${recurrence.template.description} de ${value} entra ${when} (${occurrence.toString()}).`;

    const requests: NotificationRequest[] = userIds.map((userId) => ({
      userId,
      workspaceId: recurrence.workspaceId,
      type: NotificationType.RECURRENCE_DUE_SOON,
      title,
      body,
      data: {
        recurrenceId: recurrence.id.toValue(),
        occurrenceDate: occurrence.toString(),
        amountInCents: amount.toCents(),
      },
      dedupeKey: notificationDedupeKey(
        NotificationType.RECURRENCE_DUE_SOON,
        recurrence.id.toValue(),
        occurrence.toString(),
      ),
    }));

    // Um por vez, porque o retorno individual e' que diz a quem mandar e-mail:
    // quem ja tinha o aviso nao pode receber o segundo.
    for (const request of requests) {
      const isNew = await this.notifier.push(request);

      if (!isNew) {
        continue;
      }

      report.notificationsCreated += 1;

      const user = users.get(request.userId.toValue());

      if (!user) {
        continue;
      }

      // So conta o que o servidor ACEITOU. O envio engole a falha para nao
      // derrubar o job, e um relatorio que somasse tentativas mentiria
      // justamente no dia em que o SMTP cai.
      const delivered = await this.mail.send({
        to: user.email.toString(),
        subject: title,
        text: `${body}\n\n${this.webUrl}/recorrencias`,
        html: `<p>${body}</p><p><a href="${this.webUrl}/recorrencias">Ver contas fixas</a></p>`,
      });

      if (delivered) {
        report.emailsSent += 1;
      }
    }

    await this.checkDrift(recurrence, occurrence, requests, report);
  }

  /**
   * Reajuste: o valor da serie destoa do que vinha sendo pago?
   *
   * Compara com a media dos ultimos pagamentos LIQUIDADOS. E' o aluguel que
   * subiu, a assinatura que reajustou, a conta de luz que disparou -- e o
   * usuario descobre no lembrete, nao na fatura.
   */
  private async checkDrift(
    recurrence: Recurrence,
    occurrence: CalendarDate,
    recipients: readonly NotificationRequest[],
    report: ReminderReport,
  ): Promise<void> {
    const history = await this.recurrences.settledAmounts(
      recurrence.workspaceId,
      recurrence.id,
      DRIFT_HISTORY_SIZE,
    );

    const currency = recurrence.template.amount.currency;
    const drift = recurrence.detectDrift(
      history.map((cents) => Money.fromCents(cents, currency)),
      recurrence.template.amount,
    );

    if (!drift?.isSignificant) {
      return;
    }

    const direction = drift.difference.toCents() > 0 ? 'acima' : 'abaixo';
    const percent = Math.abs(Math.round(drift.ratio * 100));

    for (const recipient of recipients) {
      const created = await this.notifier.push({
        ...recipient,
        type: NotificationType.RECURRENCE_AMOUNT_DRIFT,
        title: `${recurrence.name} mudou de valor`,
        body: `O valor esta ${percent}% ${direction} da media dos ultimos pagamentos (${formatMoney(drift.average, { locale: 'pt-BR' })}).`,
        dedupeKey: notificationDedupeKey(
          NotificationType.RECURRENCE_AMOUNT_DRIFT,
          recurrence.id.toValue(),
          occurrence.toString(),
        ),
      });

      if (created) {
        report.driftAlerts += 1;
      }
    }
  }
}
