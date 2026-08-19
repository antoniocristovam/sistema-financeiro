import {
  createSettlementBodySchema,
  splitPayloadSchema,
  type CreateSettlementBody,
  type ExpenseSplit as ExpenseSplitContract,
  type SettlementList,
  type SplitBalanceList,
  type SplitPayload,
  type TransactionSplits,
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
  Post,
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
  GetTransactionSplitsUseCase,
  ListSettlementsUseCase,
  ListSplitBalancesUseCase,
  RecordSettlementUseCase,
  RemoveSplitUseCase,
  SplitTransactionUseCase,
  type TransactionSplitsResult,
} from '../../../split/core/application/use-cases/manage-splits';
import { type ExpenseSplit } from '../../../split/core/domain/entities/expense-split';

/** Quantos acertos a tela carrega de uma vez. */
const SETTLEMENT_PAGE_SIZE = 50;

function splitToHttp(split: ExpenseSplit): ExpenseSplitContract {
  return {
    id: split.id.toValue(),
    transactionId: split.transactionId.toValue(),
    participantUserId: split.participantUserId?.toValue() ?? null,
    participantName: split.participantName,
    participantEmail: split.participantEmail?.value ?? null,
    shareType: split.shareType,
    shareValue: split.shareValue,
    amountInCents: split.amount.toCents(),
    isOwner: split.isOwner,
    status: split.status,
    settledAt: split.settledAt?.toISOString() ?? null,
  };
}

function resultToHttp(result: TransactionSplitsResult): TransactionSplits {
  return {
    transactionId: result.transactionId.toValue(),
    amountInCents: result.amountInCents,
    ownerShareInCents: result.ownerShareInCents,
    outstandingInCents: result.outstandingInCents,
    splits: result.splits.map(splitToHttp),
  };
}

/**
 * Divisao de despesas e acertos.
 *
 * A divisao NAO tem endpoint proprio de criacao de lancamento: ela se aplica a
 * uma despesa que ja existe. O lancamento continua sendo de quem pagou, com o
 * valor cheio; o que se divide e' o CUSTO (regra 6).
 */
@Controller()
export class SplitsController {
  constructor(
    private readonly splitTransaction: SplitTransactionUseCase,
    private readonly getSplits: GetTransactionSplitsUseCase,
    private readonly removeSplit: RemoveSplitUseCase,
    private readonly listBalances: ListSplitBalancesUseCase,
    private readonly recordSettlement: RecordSettlementUseCase,
    private readonly listSettlements: ListSettlementsUseCase,
  ) {}

  @Get('transactions/:transactionId/splits')
  async splits(
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<TransactionSplits> {
    const result = await this.getSplits.execute({
      workspaceId,
      userId: user.id,
      transactionId: new UniqueEntityId(transactionId),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return resultToHttp(result.value);
  }

  @Post('transactions/:transactionId/splits')
  async split(
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @Body(new ZodValidationPipe(splitPayloadSchema)) body: SplitPayload,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<TransactionSplits> {
    const result = await this.splitTransaction.execute({
      workspaceId,
      userId: user.id,
      transactionId: new UniqueEntityId(transactionId),
      shareType: body.shareType,
      participants: body.participants.map((participant) => ({
        ...(participant.participantUserId
          ? { participantUserId: participant.participantUserId }
          : {}),
        name: participant.name,
        ...(participant.email ? { email: participant.email } : {}),
        ...(participant.shareValue !== undefined
          ? { shareValue: participant.shareValue }
          : {}),
        isOwner: participant.isOwner,
      })),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return resultToHttp(result.value);
  }

  @Delete('transactions/:transactionId/splits')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsplit(
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.removeSplit.execute({
      workspaceId,
      userId: user.id,
      transactionId: new UniqueEntityId(transactionId),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Get('splits/balances')
  async balances(
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<SplitBalanceList> {
    const result = await this.listBalances.execute({ workspaceId, userId: user.id });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    const balances = result.value;

    return {
      balances,
      totalToReceiveInCents: balances
        .filter((balance) => balance.netInCents > 0)
        .reduce((sum, balance) => sum + balance.netInCents, 0),
      totalToPayInCents: balances
        .filter((balance) => balance.netInCents < 0)
        .reduce((sum, balance) => sum - balance.netInCents, 0),
    };
  }

  @Get('splits/settlements')
  async settlements(
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<SettlementList> {
    const result = await this.listSettlements.execute({
      workspaceId,
      userId: user.id,
      limit: SETTLEMENT_PAGE_SIZE,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return {
      items: result.value.map((settlement) => ({
        id: settlement.id.toValue(),
        fromName: settlement.fromName,
        fromUserId: settlement.fromUserId?.toValue() ?? null,
        toName: settlement.toName,
        toUserId: settlement.toUserId?.toValue() ?? null,
        amountInCents: settlement.amountInCents,
        date: settlement.date.toString(),
        note: settlement.note,
        transactionId: settlement.transactionId?.toValue() ?? null,
        settledSplitCount: settlement.settledSplitCount,
        createdAt: settlement.createdAt.toISOString(),
      })),
    };
  }

  @Post('splits/settlements')
  async settle(
    @Body(new ZodValidationPipe(createSettlementBodySchema)) body: CreateSettlementBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ settlementId: string; settledSplits: number }> {
    const result = await this.recordSettlement.execute({
      workspaceId,
      userId: user.id,
      participantKey: body.participantKey,
      ...(body.participantUserId ? { participantUserId: body.participantUserId } : {}),
      participantName: body.participantName,
      ...(body.participantEmail ? { participantEmail: body.participantEmail } : {}),
      amountInCents: body.amountInCents,
      direction: body.direction,
      ...(body.date ? { date: body.date } : {}),
      ...(body.note ? { note: body.note } : {}),
      ...(body.accountId ? { accountId: body.accountId } : {}),
      createTransaction: body.createTransaction,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }
}
