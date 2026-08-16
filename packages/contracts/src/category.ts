import { z } from 'zod';

import { CategoryType, TaxIncomeNature } from './enums.js';
import { zHexColor, zIconName, zInstant, zShortLabel, zUuid } from './primitives.js';

export const createCategoryBodySchema = z.object({
  name: zShortLabel,
  type: z.nativeEnum(CategoryType),
  icon: zIconName.optional(),
  color: zHexColor.optional(),
  /** Mae. Ausente = categoria principal. */
  parentId: zUuid.nullable().optional(),
  taxNature: z.nativeEnum(TaxIncomeNature).nullable().optional(),
});

export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

/** O TIPO nao muda: uma categoria de despesa virando receita inverteria o
 * sinal de todo lancamento historico dela. */
export const updateCategoryBodySchema = z.object({
  name: zShortLabel.optional(),
  icon: zIconName.nullable().optional(),
  color: zHexColor.nullable().optional(),
  taxNature: z.nativeEnum(TaxIncomeNature).nullable().optional(),
});

export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

/**
 * Reordenacao e reparentamento (drag-and-drop).
 *
 * Vem a lista INTEIRA em vez de um par (id, posicao): arrastar um item muda a
 * posicao de todos os vizinhos, e mandar um de cada vez deixaria a ordem
 * inconsistente no meio do caminho se uma das chamadas falhasse.
 */
export const reorderCategoriesBodySchema = z.object({
  items: z
    .array(
      z.object({
        id: zUuid,
        parentId: zUuid.nullable(),
        sortOrder: z.number().int().min(0),
      }),
    )
    .min(1),
});

export type ReorderCategoriesBody = z.infer<typeof reorderCategoriesBodySchema>;

/**
 * Exclusao com realocacao.
 *
 * `reassignToId` e' obrigatorio quando ha lancamento na categoria: apagar sem
 * destino deixaria transacoes sem categoria e furos no relatorio. O caso de
 * uso recusa a exclusao e diz quantos lancamentos precisam de destino.
 */
export const deleteCategoryQuerySchema = z.object({
  reassignToId: zUuid.optional(),
});

export type DeleteCategoryQuery = z.infer<typeof deleteCategoryQuerySchema>;

export const categorySchema = z.object({
  id: zUuid,
  name: z.string(),
  type: z.nativeEnum(CategoryType),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  parentId: zUuid.nullable(),
  sortOrder: z.number().int(),
  taxNature: z.nativeEnum(TaxIncomeNature).nullable(),
  /** Categoria semente nao editavel (workspace nulo). */
  isSystem: z.boolean(),
  archivedAt: zInstant.nullable(),
  transactionCount: z.number().int().nonnegative(),
});

export type Category = z.infer<typeof categorySchema>;

/** Arvore de dois niveis: a filha ja vem com icone e cor herdados resolvidos. */
export const categoryTreeNodeSchema = categorySchema.extend({
  children: z.array(categorySchema),
});

export type CategoryTreeNode = z.infer<typeof categoryTreeNodeSchema>;

export const categoryTreeSchema = z.object({
  expenses: z.array(categoryTreeNodeSchema),
  income: z.array(categoryTreeNodeSchema),
});

export type CategoryTree = z.infer<typeof categoryTreeSchema>;
