import {
  createCategoryBodySchema,
  reorderCategoriesBodySchema,
  updateCategoryBodySchema,
  type CategoryTree,
  type CreateCategoryBody,
  type ReorderCategoriesBody,
  type UpdateCategoryBody,
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
  Put,
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
  ArchiveCategoryUseCase,
  CreateCategoryUseCase,
  DeleteCategoryUseCase,
  ListCategoriesUseCase,
  ReorderCategoriesUseCase,
  UpdateCategoryUseCase,
} from '../../../category/core/application/use-cases/manage-categories';
import { CategoryPresenter } from './presenters';

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly listCategories: ListCategoriesUseCase,
    private readonly createCategory: CreateCategoryUseCase,
    private readonly updateCategory: UpdateCategoryUseCase,
    private readonly reorderCategories: ReorderCategoriesUseCase,
    private readonly archiveCategory: ArchiveCategoryUseCase,
    private readonly deleteCategory: DeleteCategoryUseCase,
  ) {}

  /** Arvore de dois niveis, com a heranca de icone e cor ja resolvida. */
  @Get()
  async list(
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<CategoryTree> {
    const result = await this.listCategories.execute(workspaceId, user.id, {
      includeArchived: includeArchived === 'true',
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return CategoryPresenter.tree(result.value);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createCategoryBodySchema)) body: CreateCategoryBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ id: string }> {
    const result = await this.createCategory.execute({
      workspaceId,
      userId: user.id,
      name: body.name,
      type: body.type,
      ...(body.icon ? { icon: body.icon } : {}),
      ...(body.color ? { color: body.color } : {}),
      parentId: body.parentId ? new UniqueEntityId(body.parentId) : null,
      taxNature: body.taxNature ?? null,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { id: result.value.id.toValue() };
  }

  @Patch(':categoryId')
  async update(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body(new ZodValidationPipe(updateCategoryBodySchema)) body: UpdateCategoryBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ id: string }> {
    const result = await this.updateCategory.execute({
      workspaceId,
      userId: user.id,
      categoryId: new UniqueEntityId(categoryId),
      ...body,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { id: result.value.id.toValue() };
  }

  /**
   * Reordenacao e reparentamento (drag-and-drop).
   *
   * `PUT` com a lista inteira: arrastar um item muda a posicao dos vizinhos, e
   * gravar item a item deixaria a ordem inconsistente se uma chamada falhasse.
   */
  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(
    @Body(new ZodValidationPipe(reorderCategoriesBodySchema)) body: ReorderCategoriesBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.reorderCategories.execute({
      workspaceId,
      userId: user.id,
      items: body.items.map((item) => ({
        id: new UniqueEntityId(item.id),
        parentId: item.parentId ? new UniqueEntityId(item.parentId) : null,
        sortOrder: item.sortOrder,
      })),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post(':categoryId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.archiveCategory.execute({
      workspaceId,
      userId: user.id,
      categoryId: new UniqueEntityId(categoryId),
      archived: true,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post(':categoryId/unarchive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unarchive(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.archiveCategory.execute({
      workspaceId,
      userId: user.id,
      categoryId: new UniqueEntityId(categoryId),
      archived: false,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  /**
   * Exclusao.
   *
   * Com lancamentos vinculados, `reassignToId` e' obrigatorio -- a resposta de
   * conflito diz quantos precisam de destino, para a UI conseguir perguntar.
   */
  @Delete(':categoryId')
  async remove(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
    @Query('reassignToId') reassignToId?: string,
  ): Promise<{ reassigned: number }> {
    const result = await this.deleteCategory.execute({
      workspaceId,
      userId: user.id,
      categoryId: new UniqueEntityId(categoryId),
      ...(reassignToId ? { reassignToId: new UniqueEntityId(reassignToId) } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }
}
