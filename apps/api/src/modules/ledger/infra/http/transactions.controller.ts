import {
  createTransactionBodySchema,
  createTransferBodySchema,
  listTransactionsQuerySchema,
  updateTransactionBodySchema,
  type CreateTransactionBody,
  type CreateTransferBody,
  type ListTransactionsQuery,
  type Transaction as TransactionContract,
  type TransactionList,
  type UpdateTransactionBody,
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
  Req,
} from '@nestjs/common';
import { type Request } from 'express';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../../../shared/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../../../shared/decorators/current-workspace.decorator';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { DomainHttpException } from '../../../../shared/filters/domain-exception.filter';
import { ZodValidationPipe } from '../../../../shared/pipes/zod-validation.pipe';
import {
  CreateTransactionUseCase,
  CreateTransferUseCase,
  DeleteTransactionUseCase,
  ListTransactionsUseCase,
  UpdateTransactionUseCase,
} from '../../../transaction/core/application/use-cases/manage-transactions';
import { TransactionPresenter } from './presenters';

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly listTransactions: ListTransactionsUseCase,
    private readonly createTransaction: CreateTransactionUseCase,
    private readonly createTransfer: CreateTransferUseCase,
    private readonly updateTransaction: UpdateTransactionUseCase,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listTransactionsQuerySchema)) query: ListTransactionsQuery,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<TransactionList> {
    const result = await this.listTransactions.execute({
      workspaceId,
      userId: user.id,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.accountId ? { accountId: new UniqueEntityId(query.accountId) } : {}),
      ...(query.categoryId ? { categoryId: new UniqueEntityId(query.categoryId) } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { search: query.search } : {}),
      includeTransfers: query.includeTransfers,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return {
      items: result.value.items.map(TransactionPresenter.toHttp),
      nextCursor: result.value.nextCursor,
      summary: result.value.summary,
    };
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createTransactionBodySchema)) body: CreateTransactionBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<TransactionContract> {
    const result = await this.createTransaction.execute({
      workspaceId,
      userId: user.id,
      type: body.type,
      accountId: new UniqueEntityId(body.accountId),
      categoryId: body.categoryId ? new UniqueEntityId(body.categoryId) : null,
      amountInCents: body.amountInCents,
      date: body.date,
      description: body.description,
      status: body.status,
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.counterpartyName ? { counterpartyName: body.counterpartyName } : {}),
      ...(body.counterpartyTaxId ? { counterpartyTaxId: body.counterpartyTaxId } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return TransactionPresenter.toHttp(result.value);
  }

  /**
   * Transferencia entre contas.
   *
   * Rota propria porque cria DUAS pernas de uma vez (regra 4). Aceitar
   * `type: TRANSFER` no POST comum abriria a porta para meia transferencia.
   */
  @Post('transfers')
  async transfer(
    @Body(new ZodValidationPipe(createTransferBodySchema)) body: CreateTransferBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ sourceId: string; destinationId: string }> {
    const result = await this.createTransfer.execute({
      workspaceId,
      userId: user.id,
      fromAccountId: new UniqueEntityId(body.fromAccountId),
      toAccountId: new UniqueEntityId(body.toAccountId),
      amountInCents: body.amountInCents,
      date: body.date,
      description: body.description,
      ...(body.notes ? { notes: body.notes } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }

  @Patch(':transactionId')
  async update(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Body(new ZodValidationPipe(updateTransactionBodySchema)) body: UpdateTransactionBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<TransactionContract> {
    const result = await this.updateTransaction.execute({
      workspaceId,
      userId: user.id,
      transactionId: new UniqueEntityId(transactionId),
      ...(body.categoryId !== undefined
        ? { categoryId: body.categoryId ? new UniqueEntityId(body.categoryId) : null }
        : {}),
      ...(body.amountInCents !== undefined ? { amountInCents: body.amountInCents } : {}),
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.counterpartyName !== undefined
        ? { counterpartyName: body.counterpartyName }
        : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return TransactionPresenter.toHttp(result.value);
  }

  @Delete(':transactionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.deleteTransaction.execute({
      workspaceId,
      userId: user.id,
      transactionId: new UniqueEntityId(transactionId),
      ...(request.ip ? { ipAddress: request.ip } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }
}
