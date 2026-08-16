import {
  CategoryType,
  type Category,
  type CategoryTreeNode,
  type ReorderCategoriesBody,
} from '@finapp/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  cn,
} from '@finapp/ui';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageHeader } from '../../components/page-header';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';

/** Paleta fixa: cor de categoria e' escolha, nao campo livre. */
const PALETTE = [
  '#F97316', '#EF4444', '#EC4899', '#A855F7', '#6366F1',
  '#0EA5E9', '#14B8A6', '#22C55E', '#84CC16', '#EAB308',
  '#64748B', '#78716C',
];

/** Subconjunto do lucide-react, para o seletor nao virar uma lista de 1500. */
const ICONS = [
  'utensils', 'house', 'car', 'heart-pulse', 'graduation-cap', 'party-popper',
  'repeat', 'shirt', 'landmark', 'wallet', 'laptop', 'trending-up',
  'shopping-cart', 'plane', 'dumbbell', 'gift', 'pill', 'book',
  'fuel', 'wifi', 'phone', 'baby', 'dog', 'briefcase',
];

export function CategoriesPage() {
  const { t } = useTranslation();
  const { categories } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState<CategoryType | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const query = useQuery({
    queryKey: ['categories', activeId],
    queryFn: () => categories.tree(activeId!),
    enabled: activeId !== null,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['categories', activeId] });

  const reorder = useMutation({
    mutationFn: (body: ReorderCategoriesBody) => categories.reorder(activeId!, body),
    onSuccess: invalidate,
    onError: (cause) => {
      setError(messageFor(cause, t));
      // A ordem local ficou otimista; recarregar traz a verdade do servidor.
      void invalidate();
    },
  });

  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      categories.archive(activeId!, id, archived),
    onSuccess: invalidate,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('categories.title')} subtitle={t('categories.subtitle')} />

      {error && <Alert tone="danger">{error}</Alert>}

      {query.isPending ? (
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <CategoryGroup
            title={t('categories.expenses')}
            type={CategoryType.EXPENSE}
            nodes={query.data?.expenses ?? []}
            onReorder={(body) => reorder.mutate(body)}
            onCreate={() => setCreating(CategoryType.EXPENSE)}
            onEdit={setEditing}
            onArchive={(category) =>
              archive.mutate({ id: category.id, archived: category.archivedAt === null })
            }
            onDelete={setDeleting}
          />

          <CategoryGroup
            title={t('categories.income')}
            type={CategoryType.INCOME}
            nodes={query.data?.income ?? []}
            onReorder={(body) => reorder.mutate(body)}
            onCreate={() => setCreating(CategoryType.INCOME)}
            onEdit={setEditing}
            onArchive={(category) =>
              archive.mutate({ id: category.id, archived: category.archivedAt === null })
            }
            onDelete={setDeleting}
          />
        </div>
      )}

      {(creating || editing) && (
        <CategoryDialog
          category={editing}
          type={editing?.type ?? creating ?? CategoryType.EXPENSE}
          parents={[...(query.data?.expenses ?? []), ...(query.data?.income ?? [])]}
          onClose={() => {
            setCreating(null);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(null);
            setEditing(null);
            void invalidate();
          }}
        />
      )}

      {deleting && (
        <DeleteCategoryDialog
          category={deleting}
          candidates={[...(query.data?.expenses ?? []), ...(query.data?.income ?? [])]}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void invalidate();
          }}
        />
      )}
    </div>
  );
}

interface GroupProps {
  title: string;
  type: CategoryType;
  nodes: CategoryTreeNode[];
  onReorder: (body: ReorderCategoriesBody) => void;
  onCreate: () => void;
  onEdit: (category: Category) => void;
  onArchive: (category: Category) => void;
  onDelete: (category: Category) => void;
}

/**
 * Lista de categorias de um tipo, com arrastar para reordenar.
 *
 * O drag reordena dentro do MESMO nivel: maes entre maes, filhas entre irmas.
 * Mudar de mae e' feito pelo seletor "categoria principal" na edicao -- o
 * arrasto entre niveis exigiria um alvo de drop ambiguo ("soltei DENTRO da
 * categoria ou DEPOIS dela?"), e o erro sai caro quando move um lancamento.
 */
function CategoryGroup({
  title,
  nodes,
  onReorder,
  onCreate,
  onEdit,
  onArchive,
  onDelete,
}: GroupProps) {
  const { t } = useTranslation();
  const [order, setOrder] = useState(nodes);

  // Reflete o servidor quando a lista muda por fora (criar, excluir, mover).
  useEffect(() => setOrder(nodes), [nodes]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent, siblings: Category[], parentId: string | null) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const from = siblings.findIndex((item) => item.id === active.id);
    const to = siblings.findIndex((item) => item.id === over.id);

    if (from < 0 || to < 0) {
      return;
    }

    const moved = arrayMove(siblings, from, to);

    // Atualizacao otimista: a lista se move antes da resposta.
    if (parentId === null) {
      setOrder(moved as CategoryTreeNode[]);
    }

    onReorder({
      items: moved.map((item, index) => ({ id: item.id, parentId, sortOrder: index })),
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('categories.new')}
        </Button>
      </CardHeader>

      <CardContent>
        {order.length === 0 ? (
          <p className="text-sm text-content-subtle">{t('categories.empty')}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => handleDragEnd(event, order, null)}
          >
            <SortableContext
              items={order.map((node) => node.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-1">
                {order.map((node) => (
                  <li key={node.id}>
                    <SortableRow
                      category={node}
                      onEdit={onEdit}
                      onArchive={onArchive}
                      onDelete={onDelete}
                    />

                    {node.children.length > 0 && (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(event) => handleDragEnd(event, node.children, node.id)}
                      >
                        <SortableContext
                          items={node.children.map((child) => child.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="mt-1 ml-6 space-y-1 border-l border-border-subtle pl-3">
                            {node.children.map((child) => (
                              <li key={child.id}>
                                <SortableRow
                                  category={child}
                                  onEdit={onEdit}
                                  onArchive={onArchive}
                                  onDelete={onDelete}
                                />
                              </li>
                            ))}
                          </ul>
                        </SortableContext>
                      </DndContext>
                    )}
                  </li>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}

function SortableRow({
  category,
  onEdit,
  onArchive,
  onDelete,
}: {
  category: Category;
  onEdit: (category: Category) => void;
  onArchive: (category: Category) => void;
  onDelete: (category: Category) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled: category.isSystem,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-border-subtle hover:bg-surface-raised',
        isDragging && 'opacity-50',
        category.archivedAt && 'opacity-50',
      )}
    >
      {!category.isSystem && (
        <button
          type="button"
          aria-label={t('categories.dragHandle')}
          className="cursor-grab touch-none text-content-subtle active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      )}

      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ background: category.color ?? 'var(--color-border-strong)' }}
      />

      <span className="min-w-0 flex-1 truncate text-sm text-content">
        {category.name}
        {category.transactionCount > 0 && (
          <span className="ml-2 text-xs text-content-subtle">
            {t('categories.usageCount', { count: category.transactionCount })}
          </span>
        )}
      </span>

      {category.isSystem ? (
        <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-content-subtle">
          {t('categories.systemBadge')}
        </span>
      ) : (
        <div className="flex gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('categories.edit')}
            onClick={() => onEdit(category)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={category.archivedAt ? t('categories.unarchive') : t('categories.archive')}
            onClick={() => onArchive(category)}
          >
            {category.archivedAt ? (
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Archive className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('categories.delete')}
            onClick={() => onDelete(category)}
          >
            <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function CategoryDialog({
  category,
  type,
  parents,
  onClose,
  onSaved,
}: {
  category: Category | null;
  type: CategoryType;
  parents: CategoryTreeNode[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { categories } = useDependencies();
  const { activeId } = useWorkspace();

  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '');
  const [color, setColor] = useState(category?.color ?? PALETTE[0]!);
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [error, setError] = useState<string | null>(null);

  // So categoria principal do MESMO tipo pode ser mae (a regra dos dois niveis
  // e o casamento de tipo sao validados no servidor de novo).
  const candidates = parents.filter(
    (parent) => parent.type === type && parent.id !== category?.id && !parent.isSystem,
  );

  const save = useMutation({
    mutationFn: async () => {
      if (category) {
        await categories.update(activeId!, category.id, {
          name: name.trim(),
          icon: icon || null,
          color,
        });
        return;
      }

      await categories.create(activeId!, {
        name: name.trim(),
        type,
        ...(icon ? { icon } : {}),
        color,
        parentId: parentId || null,
      });
    },
    onSuccess: onSaved,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="max-h-[90dvh] w-full max-w-md overflow-y-auto">
        <CardHeader>
          <CardTitle>{category ? t('categories.edit') : t('categories.new')}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label={t('categories.name')} required>
            {({ id }) => (
              <Input
                id={id}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          {!category && candidates.length > 0 && (
            <Field label={t('categories.parent')}>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                >
                  <option value="">{t('categories.noParent')}</option>
                  {candidates.map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {parent.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <Field label={t('categories.color')}>
            {() => (
              <div className="flex flex-wrap gap-2">
                {PALETTE.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={option}
                    aria-pressed={color === option}
                    onClick={() => setColor(option)}
                    className={cn(
                      'h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition-shadow',
                      color === option && 'ring-2 ring-brand',
                    )}
                    style={{ background: option }}
                  />
                ))}
              </div>
            )}
          </Field>

          <Field label={t('categories.icon')}>
            {() => (
              <div className="grid grid-cols-8 gap-1">
                {ICONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={option}
                    aria-pressed={icon === option}
                    onClick={() => setIcon(icon === option ? '' : option)}
                    className={cn(
                      'flex h-9 items-center justify-center rounded-lg border text-xs',
                      icon === option
                        ? 'border-brand bg-surface-raised'
                        : 'border-border-subtle hover:bg-surface-raised',
                    )}
                  >
                    {option.slice(0, 2)}
                  </button>
                ))}
              </div>
            )}
          </Field>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" full onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button full disabled={save.isPending || name.trim() === ''} onClick={() => save.mutate()}>
              {save.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Exclusao com realocacao.
 *
 * Quando ha lancamento vinculado, o destino e' OBRIGATORIO -- e a tela ja
 * pergunta antes de tentar, em vez de deixar a API recusar e o usuario
 * descobrir o problema num toast.
 */
function DeleteCategoryDialog({
  category,
  candidates,
  onClose,
  onDeleted,
}: {
  category: Category;
  candidates: CategoryTreeNode[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { categories } = useDependencies();
  const { activeId } = useWorkspace();

  const [reassignTo, setReassignTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const needsReassign = category.transactionCount > 0;

  const options = candidates
    .flatMap((parent) => [parent, ...parent.children])
    .filter((option) => option.type === category.type && option.id !== category.id);

  const remove = useMutation({
    mutationFn: () =>
      categories.remove(activeId!, category.id, reassignTo || undefined),
    onSuccess: onDeleted,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('categories.deleteTitle')}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <p className="text-sm text-content">{category.name}</p>

          {needsReassign && (
            <>
              <Alert tone="info">
                {t('categories.deleteWithTransactions', { count: category.transactionCount })}
              </Alert>

              <Field label={t('categories.reassignTo')} required>
                {({ id }) => (
                  <select
                    id={id}
                    className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    value={reassignTo}
                    onChange={(event) => setReassignTo(event.target.value)}
                  >
                    <option value="">—</option>
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" full onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              full
              disabled={remove.isPending || (needsReassign && reassignTo === '')}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? t('common.loading') : t('categories.delete')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
