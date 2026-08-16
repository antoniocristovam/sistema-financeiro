import {
  createAccountBodySchema,
  updateAccountBodySchema,
  type AccountList,
  type Account as AccountContract,
  type CreateAccountBody,
  type UpdateAccountBody,
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
  ArchiveAccountUseCase,
  CreateAccountUseCase,
  DeleteAccountUseCase,
  ListAccountsUseCase,
  UpdateAccountUseCase,
} from '../../../account/core/application/use-cases/manage-accounts';
import { AccountPresenter } from './presenters';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly listAccounts: ListAccountsUseCase,
    private readonly createAccount: CreateAccountUseCase,
    private readonly updateAccount: UpdateAccountUseCase,
    private readonly archiveAccount: ArchiveAccountUseCase,
    private readonly deleteAccount: DeleteAccountUseCase,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<AccountList> {
    const result = await this.listAccounts.execute(workspaceId, user.id, {
      includeArchived: includeArchived === 'true',
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return {
      accounts: result.value.map(AccountPresenter.toHttp),
      totalBalanceInCents: AccountPresenter.total(result.value),
    };
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createAccountBodySchema)) body: CreateAccountBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
    @Req() request: Request,
  ): Promise<{ id: string }> {
    const result = await this.createAccount.execute({
      workspaceId,
      userId: user.id,
      ...body,
      ...(request.ip ? { ipAddress: request.ip } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { id: result.value.id.toValue() };
  }

  @Patch(':accountId')
  async update(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body(new ZodValidationPipe(updateAccountBodySchema)) body: UpdateAccountBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ id: string }> {
    const result = await this.updateAccount.execute({
      workspaceId,
      userId: user.id,
      accountId: new UniqueEntityId(accountId),
      ...body,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { id: result.value.id.toValue() };
  }

  /** Arquivar e' o caminho normal para conta usada; excluir so se estiver vazia. */
  @Post(':accountId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.archiveAccount.execute({
      workspaceId,
      userId: user.id,
      accountId: new UniqueEntityId(accountId),
      archived: true,
      ...(request.ip ? { ipAddress: request.ip } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post(':accountId/unarchive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unarchive(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.archiveAccount.execute({
      workspaceId,
      userId: user.id,
      accountId: new UniqueEntityId(accountId),
      archived: false,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Delete(':accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.deleteAccount.execute({
      workspaceId,
      userId: user.id,
      accountId: new UniqueEntityId(accountId),
      ...(request.ip ? { ipAddress: request.ip } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }
}

export type { AccountContract };
