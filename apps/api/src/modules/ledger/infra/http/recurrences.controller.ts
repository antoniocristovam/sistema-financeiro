import {
  createRecurrenceBodySchema,
  listRecurrencesQuerySchema,
  skipOccurrenceBodySchema,
  updateRecurrenceBodySchema,
  type CreateRecurrenceBody,
  type ListRecurrencesQuery,
  type Recurrence as RecurrenceContract,
  type RecurrenceList,
  type RecurrenceOccurrence,
  type SkipOccurrenceBody,
  type UpdateRecurrenceBody,
} from '@finapp/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../../../shared/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../../../shared/decorators/current-workspace.decorator';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { DomainHttpException } from '../../../../shared/filters/domain-exception.filter';
import { ZodValidationPipe } from '../../../../shared/pipes/zod-validation.pipe';
import {
  CreateRecurrenceUseCase,
  DeleteRecurrenceUseCase,
  ListRecurrenceOccurrencesUseCase,
  ListRecurrencesUseCase,
  SkipOccurrenceUseCase,
  UpdateRecurrenceUseCase,
  type RecurrenceWithProjection,
} from '../../../transaction/core/application/use-cases/manage-recurrences';

/** Quantos meses de linha do tempo a tela pede por padrao. */
const OCCURRENCE_MONTHS = 3;

function toHttp(entry: RecurrenceWithProjection): RecurrenceContract {
  const { recurrence } = entry.view;
  const { schedule, template } = recurrence;

  return {
    id: recurrence.id.toValue(),
    name: recurrence.name,
    template: {
      type: template.type,
      accountId: template.accountId.toValue(),
      categoryId: template.categoryId?.toValue() ?? null,
      amountInCents: template.amount.toCents(),
      description: template.description,
      ...(template.notes ? { notes: template.notes } : {}),
      accountName: entry.view.accountName,
      categoryName: entry.view.categoryName,
    },
    frequency: schedule.frequency,
    interval: schedule.interval,
    dayOfMonth: schedule.dayOfMonth,
    weekday: schedule.weekday,
    monthOfYear: schedule.monthOfYear,
    startDate: schedule.startDate.toString(),
    endDate: schedule.endDate?.toString() ?? null,
    reminderDaysBefore: recurrence.reminderDaysBefore,
    isActive: recurrence.isActive,
    nextOccurrence: entry.nextOccurrence?.toString() ?? null,
    monthlyAmountInCents: entry.monthlyAmountInCents,
    createdAt: recurrence.createdAt.toISOString(),
  };
}

/**
 * Contas fixas.
 *
 * O que esta tela cadastra e' uma REGRA, nao lancamentos: quem cria os
 * lancamentos e' o job diario, dentro de uma janela de 60 dias. Por isso nao
 * existe rota de "gerar agora" -- gerar sob demanda daria ao usuario a
 * impressao de que a serie so existe quando ele abre a tela.
 */
@Controller('recurrences')
export class RecurrencesController {
  constructor(
    private readonly listRecurrences: ListRecurrencesUseCase,
    private readonly createRecurrence: CreateRecurrenceUseCase,
    private readonly updateRecurrence: UpdateRecurrenceUseCase,
    private readonly deleteRecurrence: DeleteRecurrenceUseCase,
    private readonly listOccurrences: ListRecurrenceOccurrencesUseCase,
    private readonly skipOccurrence: SkipOccurrenceUseCase,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listRecurrencesQuerySchema)) query: ListRecurrencesQuery,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<RecurrenceList> {
    const result = await this.listRecurrences.execute({
      workspaceId,
      userId: user.id,
      includeInactive: query.includeInactive,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return {
      items: result.value.items.map(toHttp),
      monthlyCommittedInCents: result.value.monthlyCommittedInCents,
    };
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createRecurrenceBodySchema)) body: CreateRecurrenceBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<RecurrenceContract> {
    const result = await this.createRecurrence.execute({
      workspaceId,
      userId: user.id,
      name: body.name,
      template: {
        type: body.template.type,
        accountId: body.template.accountId,
        categoryId: body.template.categoryId,
        amountInCents: body.template.amountInCents,
        description: body.template.description,
        ...(body.template.notes ? { notes: body.template.notes } : {}),
      },
      schedule: {
        frequency: body.frequency,
        interval: body.interval,
        dayOfMonth: body.dayOfMonth,
        weekday: body.weekday,
        monthOfYear: body.monthOfYear,
        startDate: body.startDate,
        endDate: body.endDate,
      },
      reminderDaysBefore: body.reminderDaysBefore,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return toHttp(result.value);
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateRecurrenceBodySchema)) body: UpdateRecurrenceBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<RecurrenceContract> {
    const result = await this.updateRecurrence.execute({
      workspaceId,
      userId: user.id,
      recurrenceId: new UniqueEntityId(id),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.template !== undefined ? { template: body.template } : {}),
      ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
      ...(body.reminderDaysBefore !== undefined
        ? { reminderDaysBefore: body.reminderDaysBefore }
        : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return toHttp(result.value);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.deleteRecurrence.execute({
      workspaceId,
      userId: user.id,
      recurrenceId: new UniqueEntityId(id),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Get(':id/occurrences')
  async occurrences(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<RecurrenceOccurrence[]> {
    const result = await this.listOccurrences.execute({
      workspaceId,
      userId: user.id,
      recurrenceId: new UniqueEntityId(id),
      months: OCCURRENCE_MONTHS,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }

  @Post(':id/skips')
  @HttpCode(HttpStatus.NO_CONTENT)
  async skip(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(skipOccurrenceBodySchema)) body: SkipOccurrenceBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.skipOccurrence.execute({
      workspaceId,
      userId: user.id,
      recurrenceId: new UniqueEntityId(id),
      occurrenceDate: body.occurrenceDate,
      ...(body.reason ? { reason: body.reason } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }
}
