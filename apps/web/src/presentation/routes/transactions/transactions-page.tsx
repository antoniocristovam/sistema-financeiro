import {
  TransactionStatus,
  TransactionType,
  type Transaction,
} from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Card, CardContent, Field, Input, cn } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Minus, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '../../components/page-header';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation, type TranslationKey } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';
import { TransactionDialog, type DialogMode } from './transaction-dialog';

const CURRENCY = 'BRL';

interface Filters {
  from: string;
  to: string;
  accountId: string;
  categoryId: string;
  type: string;
  search: string;
  includeTransfers: boolean;
}

const EMPTY_FILTERS: Filters = {
  from: '',
  to: '',
  accountId: '',
  categoryId: '',
  type: '',
  search: '',
  includeTransfers: true,
};

export function TransactionsPage() {
  const { t, tag } = useTranslation();
  const { transactions, accounts, categories } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [cursors, setCursors] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts', activeId, false],
    queryFn: () => accounts.list(activeId!),
    enabled: activeId !== null,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', activeId],
    queryFn: () => categories.tree(activeId!),
    enabled: activeId !== null,
  });

  const query = useQuery({
    queryKey: ['transactions', activeId, filters, cursors.length],
    queryFn: () =>
      transactions.list(activeId!, {
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.type ? { type: filters.type as TransactionType } : {}),
        ...(filters.search ? { search: filters.search } : {}),
        includeTransfers: filters.includeTransfers,
        ...(cursors.at(-1) ? { cursor: cursors.at(-1) } : {}),
        limit: 25,
      }),
    enabled: activeId !== null,
  });

  const invalidate = () => {
    // O saldo das contas depende dos lancamentos: invalidar os dois.
    void queryClient.invalidateQueries({ queryKey: ['transactions', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['accounts', activeId] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => transactions.remove(activeId!, id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const updateFilter = (patch: Partial<Filters>): void => {
    setFilters((current) => ({ ...current, ...patch }));
    // Filtro novo, paginacao do zero: manter o cursor antigo devolveria uma
    // pagina do meio de outra consulta.
    setCursors([]);
  };

  const accountList = accountsQuery.data?.accounts ?? [];
  const categoryTree = categoriesQuery.data;
  const allCategories = [
    ...(categoryTree?.expenses ?? []),
    ...(categoryTree?.income ?? []),
  ].flatMap((parent) => [parent, ...parent.children]);

  const summary = query.data?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('transactions.title')}
        subtitle={t('transactions.subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog({ kind: 'INCOME' })}>
              <Plus className="h-4 w-4 text-income" aria-hidden />
              {t('transactions.newIncome')}
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'TRANSFER' })}>
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
              {t('transactions.newTransfer')}
            </Button>
            <Button onClick={() => setDialog({ kind: 'EXPENSE' })}>
              <Minus className="h-4 w-4" aria-hidden />
              {t('transactions.newExpense')}
            </Button>
          </div>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {/* Resumo do periodo FILTRADO. Transferencia fica fora dos dois lados. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          label={t('transactions.income')}
          value={summary?.incomeInCents ?? 0}
          tone="income"
          locale={tag}
        />
        <SummaryTile
          label={t('transactions.expense')}
          value={summary?.expenseInCents ?? 0}
          tone="expense"
          locale={tag}
        />
        <SummaryTile
          label={t('transactions.net')}
          value={summary?.netInCents ?? 0}
          tone="neutral"
          locale={tag}
          hint={t('transactions.transferNote')}
        />
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('transactions.from')}>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={filters.from}
                onChange={(event) => updateFilter({ from: event.target.value })}
              />
            )}
          </Field>

          <Field label={t('transactions.to')}>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={filters.to}
                onChange={(event) => updateFilter({ to: event.target.value })}
              />
            )}
          </Field>

          <Field label={t('transactions.account')}>
            {({ id }) => (
              <select
                id={id}
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                value={filters.accountId}
                onChange={(event) => updateFilter({ accountId: event.target.value })}
              >
                <option value="">{t('transactions.allAccounts')}</option>
                {accountList.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={t('transactions.category')}>
            {({ id }) => (
              <select
                id={id}
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                value={filters.categoryId}
                onChange={(event) => updateFilter({ categoryId: event.target.value })}
              >
                <option value="">{t('transactions.allCategories')}</option>
                {allCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field label={t('transactions.search')}>
              {({ id }) => (
                <Input
                  id={id}
                  placeholder={t('transactions.searchPlaceholder')}
                  value={filters.search}
                  onChange={(event) => updateFilter({ search: event.target.value })}
                />
              )}
            </Field>
          </div>

          <label className="flex items-end gap-2 pb-2 text-sm text-content-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-brand)]"
              checked={filters.includeTransfers}
              onChange={(event) => updateFilter({ includeTransfers: event.target.checked })}
            />
            {t('transactions.includeTransfers')}
          </label>

          <div className="flex items-end">
            <Button variant="ghost" onClick={() => updateFilter(EMPTY_FILTERS)}>
              {t('transactions.clearFilters')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {query.isPending ? (
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-content-subtle">{t('transactions.empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {query.data!.items.map((item) => (
            <li key={item.id}>
              <TransactionRow
                transaction={item}
                locale={tag}
                onEdit={() => setDialog({ kind: 'EDIT', transaction: item })}
                onDelete={() => {
                  const message = item.transferPairId
                    ? t('transactions.deleteTransferConfirm')
                    : t('transactions.deleteConfirm');

                  if (confirm(message)) {
                    remove.mutate(item.id);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {query.data?.nextCursor && (
        <Button
          variant="secondary"
          full
          onClick={() => setCursors((current) => [...current, query.data!.nextCursor!])}
        >
          {t('transactions.loadMore')}
        </Button>
      )}

      {dialog && (
        <TransactionDialog
          mode={dialog}
          accounts={accountList}
          categories={allCategories}
          currency={CURRENCY}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  locale,
  hint,
}: {
  label: string;
  value: number;
  tone: 'income' | 'expense' | 'neutral';
  locale: string;
  hint?: string;
}) {
  const toneClass = {
    income: 'text-income',
    expense: 'text-expense',
    neutral: value < 0 ? 'text-expense' : 'text-content',
  }[tone];

  return (
    <Card className="p-4">
      <p className="text-xs text-content-muted">{label}</p>
      <p className={cn('tabular text-xl font-semibold', toneClass)}>
        {formatMoney(Money.fromCents(value, CURRENCY), { locale })}
      </p>
      {hint && <p className="mt-0.5 text-xs text-content-subtle">{hint}</p>}
    </Card>
  );
}

function TransactionRow({
  transaction,
  locale,
  onEdit,
  onDelete,
}: {
  transaction: Transaction;
  locale: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isTransfer = transaction.type === TransactionType.TRANSFER;
  const isPending = transaction.status === TransactionStatus.PENDING;

  return (
    <Card className={cn('flex items-center gap-3 p-3', isPending && 'border-dashed')}>
      <span
        aria-hidden
        className="h-8 w-1 shrink-0 rounded-full"
        style={{
          background: isTransfer
            ? 'var(--color-transfer)'
            : (transaction.category?.color ?? 'var(--color-border-strong)'),
        }}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-content">
          {transaction.description}
          {transaction.installmentNumber && transaction.installmentTotal && (
            <span className="ml-2 text-xs text-content-subtle">
              {t('transactions.installment', {
                current: transaction.installmentNumber,
                total: transaction.installmentTotal,
              })}
            </span>
          )}
        </p>

        <p className="truncate text-xs text-content-subtle">
          {transaction.date}
          {' · '}
          {transaction.account.name}
          {isTransfer && transaction.transferCounterpartAccount && (
            <>
              {' → '}
              {transaction.transferCounterpartAccount.name}
            </>
          )}
          {transaction.category && (
            <>
              {' · '}
              {transaction.category.parentName
                ? `${transaction.category.parentName} / ${transaction.category.name}`
                : transaction.category.name}
            </>
          )}
          {isPending && ` · ${t('transactions.statuses.PENDING')}`}
        </p>
      </div>

      {transaction.attachmentCount > 0 && (
        <span
          className="flex shrink-0 items-center gap-0.5 text-xs text-content-subtle"
          title={t('attachments.title')}
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          {transaction.attachmentCount}
        </span>
      )}

      <p
        className={cn(
          'tabular shrink-0 text-sm font-semibold',
          isTransfer
            ? 'text-transfer'
            : transaction.signedAmountInCents < 0
              ? 'text-expense'
              : 'text-income',
        )}
      >
        {formatMoney(Money.fromCents(transaction.signedAmountInCents, CURRENCY), {
          locale,
          alwaysShowSign: !isTransfer,
        })}
      </p>

      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t('transactions.editTitle')}
          onClick={onEdit}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t('transactions.delete')}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
        </Button>
      </div>
    </Card>
  );
}

export type { TranslationKey };
