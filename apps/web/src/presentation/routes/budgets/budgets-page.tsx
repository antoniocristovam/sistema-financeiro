import { type Budget, type Category } from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Card, CardContent, Field, ProgressBar, cn } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { MoneyInput } from '../../components/money-input';
import { PageHeader } from '../../components/page-header';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';

const CURRENCY = 'BRL';

/** Mes corrente em `YYYY-MM`. */
function currentMonth(): string {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, index - 1 + by, 1));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Orcamentos do mes.
 *
 * A tela responde "quanto ainda posso gastar em cada coisa". O numero que
 * costuma passar despercebido -- e que esta aqui de proposito -- e' o gasto
 * FORA de orcamento: tres categorias sob controle nao dizem nada sobre o mes se
 * o dinheiro esta escorrendo pelas outras.
 */
export function BudgetsPage() {
  const { t, tag } = useTranslation();
  const { budgets, categories } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(currentMonth());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['budgets', activeId, month],
    queryFn: () => budgets.list(activeId!, month),
    enabled: activeId !== null,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', activeId],
    queryFn: () => categories.tree(activeId!),
    enabled: activeId !== null,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['budgets', activeId] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => budgets.remove(activeId!, id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const copy = useMutation({
    mutationFn: () =>
      budgets.copy(activeId!, { from: shiftMonth(month, -1), to: month, overwrite: false }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const items = query.data?.items ?? [];
  const money = (cents: number): string =>
    formatMoney(Money.fromCents(cents, CURRENCY), { locale: tag });

  const expenseCategories = [...(categoriesQuery.data?.expenses ?? [])].flatMap((parent) => [
    parent,
    ...parent.children,
  ]);

  const used = new Set(items.map((item) => item.category.id));
  const available = expenseCategories.filter(
    (category) => !used.has(category.id) && category.archivedAt === null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('budgets.title')}
        subtitle={t('budgets.subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={copy.isPending}
              onClick={() => copy.mutate()}
            >
              <Copy className="h-4 w-4" aria-hidden />
              {t('budgets.copyPrevious')}
            </Button>
            <Button disabled={available.length === 0} onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('budgets.new')}
            </Button>
          </div>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('budgets.previousMonth')}
              onClick={() => setMonth((value) => shiftMonth(value, -1))}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>

            <span className="tabular text-sm font-medium text-content">{month}</span>

            <Button
              variant="ghost"
              size="icon"
              aria-label={t('budgets.nextMonth')}
              onClick={() => setMonth((value) => shiftMonth(value, 1))}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className="flex flex-wrap gap-6 text-xs">
            <span>
              <span className="block text-content-subtle">{t('budgets.totalConsumed')}</span>
              <span className="tabular text-content">
                {money(query.data?.totalConsumedInCents ?? 0)} /{' '}
                {money(query.data?.totalLimitInCents ?? 0)}
              </span>
            </span>

            <span>
              <span className="block text-content-subtle">{t('budgets.unbudgeted')}</span>
              <span className="tabular text-content">
                {money(query.data?.unbudgetedInCents ?? 0)}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      {query.isPending ? (
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <PiggyBank className="mx-auto h-8 w-8 text-content-subtle" aria-hidden />
            <p className="mt-3 text-sm text-content-muted">{t('budgets.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((budget) => (
            <li key={budget.id}>
              <BudgetRow
                budget={budget}
                locale={tag}
                onDelete={() => {
                  if (confirm(t('budgets.deleteConfirm'))) {
                    remove.mutate(budget.id);
                  }
                }}
                onChanged={invalidate}
                onError={setError}
              />
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <BudgetDialog
          month={month}
          categories={available}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function BudgetRow({
  budget,
  locale,
  onDelete,
  onChanged,
  onError,
}: {
  budget: Budget;
  locale: string;
  onDelete: () => void;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const { budgets } = useDependencies();
  const { activeId } = useWorkspace();

  const toggleRollover = useMutation({
    mutationFn: () => budgets.update(activeId!, budget.id, { rollover: !budget.rollover }),
    onSuccess: () => {
      onError(null);
      onChanged();
    },
    onError: (cause) => onError(messageFor(cause, t)),
  });

  const money = (cents: number): string =>
    formatMoney(Money.fromCents(cents, CURRENCY), { locale });

  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-content">
              {budget.category.parentName
                ? `${budget.category.parentName} / ${budget.category.name}`
                : budget.category.name}
            </p>
            <p className="mt-0.5 text-xs text-content-subtle">
              {money(budget.consumedInCents)} {t('budgets.of')}{' '}
              {money(budget.effectiveLimitInCents)}
              {budget.carryOverInCents > 0 && (
                <> · {t('budgets.carryOver', { value: money(budget.carryOverInCents) })}</>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={cn(
                'tabular text-sm font-semibold',
                budget.band === 'OVER' && 'text-danger',
                budget.band === 'NEAR' && 'text-warning',
                budget.band === 'OK' && 'text-content',
              )}
            >
              {budget.percent}%
            </span>

            <Button variant="ghost" size="icon" aria-label={t('common.delete')} onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-danger" aria-hidden />
            </Button>
          </div>
        </div>

        <ProgressBar percent={Math.min(100, budget.percent)} />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span
            className={cn(
              budget.remainingInCents < 0 ? 'text-danger' : 'text-content-muted',
            )}
          >
            {budget.remainingInCents < 0
              ? t('budgets.over', { value: money(-budget.remainingInCents) })
              : t('budgets.remaining', { value: money(budget.remainingInCents) })}
          </span>

          <label className="flex items-center gap-2 text-content-subtle">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border-subtle"
              checked={budget.rollover}
              disabled={toggleRollover.isPending}
              onChange={() => toggleRollover.mutate()}
            />
            {t('budgets.rollover')}
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function BudgetDialog({
  month,
  categories,
  onClose,
  onSaved,
}: {
  month: string;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { budgets } = useDependencies();
  const { activeId } = useWorkspace();

  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [limit, setLimit] = useState(0);
  const [rollover, setRollover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      budgets.create(activeId!, {
        categoryId,
        referenceMonth: month,
        limitInCents: limit,
        rollover,
      }),
    onSuccess: onSaved,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium text-content">
            {t('budgets.new')} · <span className="tabular">{month}</span>
          </p>

          {error && <Alert tone="danger">{error}</Alert>}

          <Field label={t('transactions.category')} required>
            {({ id }) => (
              <select
                id={id}
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.parentId ? `— ${category.name}` : category.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={t('budgets.limit')} required>
            {({ id }) => (
              <MoneyInput
                id={id}
                valueInCents={limit}
                onChange={setLimit}
                currency={CURRENCY}
              />
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm text-content-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border-subtle"
              checked={rollover}
              onChange={(event) => setRollover(event.target.checked)}
            />
            {t('budgets.rolloverHint')}
          </label>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" full onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              full
              disabled={save.isPending || limit <= 0 || categoryId === ''}
              onClick={() => save.mutate()}
            >
              {save.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
