import { type RecurrenceFrequency } from '@finapp/contracts';
import { Money } from '@finapp/money';
import { type Recurrence as PrismaRecurrence } from '@prisma/client';

import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { Recurrence } from '../../core/domain/entities/recurrence';
import { RecurrenceSchedule } from '../../core/domain/value-objects/recurrence-schedule';

/**
 * O template mora em JSON.
 *
 * Nao e' preguica: o template e' um lancamento POTENCIAL, com forma propria e
 * sem integridade referencial obrigatoria (a categoria pode ter sido excluida
 * depois). Espalha-lo em colunas duplicaria metade de `transactions` para
 * ganhar consultas que ninguem faz -- nunca se filtra recorrencia por valor.
 *
 * Em compensacao ele e' validado na leitura: JSON malformado vira erro alto e
 * imediato, e nao um template silenciosamente vazio gerando lancamento errado.
 */
interface TemplateJson {
  accountId: string;
  categoryId: string | null;
  type: 'INCOME' | 'EXPENSE';
  amountInCents: number;
  description: string;
  notes: string | null;
}

function parseTemplate(raw: unknown, id: string): TemplateJson {
  const value = raw as Partial<TemplateJson> | null;

  if (
    !value ||
    typeof value.accountId !== 'string' ||
    typeof value.amountInCents !== 'number' ||
    typeof value.description !== 'string' ||
    (value.type !== 'INCOME' && value.type !== 'EXPENSE')
  ) {
    throw new Error(`Template invalido na recorrencia ${id}.`);
  }

  return {
    accountId: value.accountId,
    categoryId: value.categoryId ?? null,
    type: value.type,
    amountInCents: value.amountInCents,
    description: value.description,
    notes: value.notes ?? null,
  };
}

export class RecurrenceMapper {
  static toDomain(raw: PrismaRecurrence, currency: string): Recurrence {
    const template = parseTemplate(raw.templateData, raw.id);

    const schedule = RecurrenceSchedule.create({
      frequency: raw.frequency as RecurrenceFrequency,
      interval: raw.interval,
      dayOfMonth: raw.dayOfMonth,
      weekday: raw.weekday,
      monthOfYear: raw.monthOfYear,
      startDate: CalendarDate.fromUtcDate(raw.startDate),
      endDate: raw.endDate ? CalendarDate.fromUtcDate(raw.endDate) : null,
    });

    if (schedule.isLeft()) {
      throw new Error(`Regra invalida na recorrencia ${raw.id}: ${schedule.value.message}`);
    }

    return Recurrence.create(
      {
        workspaceId: new UniqueEntityId(raw.workspaceId),
        createdByUserId: new UniqueEntityId(raw.createdByUserId),
        name: raw.name,
        template: {
          accountId: new UniqueEntityId(template.accountId),
          categoryId: template.categoryId ? new UniqueEntityId(template.categoryId) : null,
          type: template.type,
          amount: Money.fromCents(template.amountInCents, currency),
          description: template.description,
          notes: template.notes,
        },
        schedule: schedule.value,
        materializedUntil: raw.materializedUntil
          ? CalendarDate.fromUtcDate(raw.materializedUntil)
          : null,
        reminderDaysBefore: raw.reminderDaysBefore,
        isActive: raw.isActive,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static toPrisma(recurrence: Recurrence) {
    const { schedule, template } = recurrence;

    return {
      id: recurrence.id.toValue(),
      workspaceId: recurrence.workspaceId.toValue(),
      createdByUserId: recurrence.createdByUserId.toValue(),
      name: recurrence.name,
      templateData: {
        accountId: template.accountId.toValue(),
        categoryId: template.categoryId?.toValue() ?? null,
        type: template.type,
        amountInCents: template.amount.toCents(),
        description: template.description,
        notes: template.notes,
      } satisfies TemplateJson,
      frequency: schedule.frequency,
      interval: schedule.interval,
      dayOfMonth: schedule.dayOfMonth,
      weekday: schedule.weekday,
      monthOfYear: schedule.monthOfYear,
      startDate: schedule.startDate.toUtcDate(),
      endDate: schedule.endDate?.toUtcDate() ?? null,
      // `nextRunAt` e' operacional: e' por ele que o job varre quem esta
      // atrasado sem precisar abrir a regra de cada serie.
      nextRunAt: (recurrence.materializedUntil ?? schedule.startDate).toUtcDate(),
      materializedUntil: recurrence.materializedUntil?.toUtcDate() ?? null,
      reminderDaysBefore: recurrence.reminderDaysBefore,
      isActive: recurrence.isActive,
    };
  }
}
