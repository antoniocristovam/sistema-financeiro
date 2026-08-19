import {
  TransactionStatus,
  TransactionType,
  type Account,
  type Category,
  type Transaction,
} from '@finapp/contracts';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@finapp/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { AttachmentsPanel } from '../../components/attachments-panel';
import { SplitPanel } from '../../components/split-panel';
import { MoneyInput } from '../../components/money-input';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';

export type DialogMode =
  | { kind: 'INCOME' }
  | { kind: 'EXPENSE' }
  | { kind: 'TRANSFER' }
  | { kind: 'EDIT'; transaction: Transaction };

/** Hoje, no fuso local, no formato do `<input type="date">`. */
function today(): string {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Formulario de lancamento.
 *
 * Transferencia tem forma propria (duas contas, sem categoria) porque e' uma
 * operacao diferente: ela cria DUAS pernas de uma vez, e nao aceita categoria
 * -- transferencia nao entra em relatorio por categoria (regra 4).
 */
export function TransactionDialog({
  mode,
  accounts,
  categories,
  currency,
  onClose,
  onSaved,
}: {
  mode: DialogMode;
  accounts: Account[];
  categories: Category[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { transactions } = useDependencies();
  const { activeId } = useWorkspace();

  const editing = mode.kind === 'EDIT' ? mode.transaction : null;
  const isTransfer =
    mode.kind === 'TRANSFER' || editing?.type === TransactionType.TRANSFER;
  const type =
    mode.kind === 'EDIT'
      ? editing!.type
      : mode.kind === 'INCOME'
        ? TransactionType.INCOME
        : mode.kind === 'EXPENSE'
          ? TransactionType.EXPENSE
          : TransactionType.TRANSFER;

  const usable = accounts.filter((account) => account.archivedAt === null);

  const [description, setDescription] = useState(editing?.description ?? '');
  const [amount, setAmount] = useState(editing?.amountInCents ?? 0);
  const [date, setDate] = useState(editing?.date ?? today());
  const [accountId, setAccountId] = useState(editing?.account.id ?? usable[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(
    editing?.transferCounterpartAccount?.id ?? usable[1]?.id ?? '',
  );
  const [categoryId, setCategoryId] = useState(editing?.category?.id ?? '');
  const [status, setStatus] = useState<TransactionStatus>(
    editing?.status ?? TransactionStatus.SETTLED,
  );
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  // A categoria precisa casar com o tipo: despesa nao aceita categoria de
  // receita, e o servidor recusa de qualquer forma.
  const options = categories.filter(
    (category) =>
      category.archivedAt === null &&
      category.type === (type === TransactionType.INCOME ? 'INCOME' : 'EXPENSE'),
  );

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await transactions.update(activeId!, editing.id, {
          description: description.trim(),
          amountInCents: amount,
          date,
          status,
          notes: notes.trim() || undefined,
          ...(isTransfer ? {} : { categoryId: categoryId || null }),
        });
        return;
      }

      if (isTransfer) {
        await transactions.transfer(activeId!, {
          fromAccountId: accountId,
          toAccountId,
          amountInCents: amount,
          date,
          description: description.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        });
        return;
      }

      await transactions.create(activeId!, {
        type: type as 'INCOME' | 'EXPENSE',
        accountId,
        categoryId: categoryId || null,
        amountInCents: amount,
        date,
        description: description.trim(),
        status,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
    },
    onSuccess: onSaved,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const title = editing
    ? t('transactions.editTitle')
    : isTransfer
      ? t('transactions.newTransfer')
      : type === TransactionType.INCOME
        ? t('transactions.newIncome')
        : t('transactions.newExpense');

  const invalid =
    description.trim() === '' ||
    amount <= 0 ||
    date === '' ||
    accountId === '' ||
    (isTransfer && !editing && (toAccountId === '' || toAccountId === accountId));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="max-h-[90dvh] w-full max-w-md overflow-y-auto">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label={t('transactions.description')} required>
            {({ id }) => (
              <Input
                id={id}
                autoFocus
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>

          <Field label={t('transactions.amount')} required>
            {({ id }) => (
              <MoneyInput
                id={id}
                valueInCents={amount}
                onChange={setAmount}
                currency={currency}
              />
            )}
          </Field>

          <Field label={t('transactions.date')} required>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </Field>

          {/* Na edicao, a conta nao muda: mover um lancamento entre contas
              mexe no saldo das duas e e' mais claro como excluir e recriar. */}
          {!editing && (
            <Field label={isTransfer ? t('transactions.fromAccount') : t('transactions.account')} required>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  {usable.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {isTransfer && !editing && (
            <Field label={t('transactions.toAccount')} required>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                  value={toAccountId}
                  onChange={(event) => setToAccountId(event.target.value)}
                >
                  {usable
                    .filter((account) => account.id !== accountId)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          )}

          {/* Transferencia nao tem categoria: ela nao entra em relatorio por
              categoria (regra 4). */}
          {!isTransfer && (
            <Field label={t('transactions.category')}>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">{t('transactions.noCategory')}</option>
                  {options.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.parentId ? `— ${category.name}` : category.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <Field label={t('transactions.status')}>
            {({ id }) => (
              <select
                id={id}
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                value={status}
                onChange={(event) => setStatus(event.target.value as TransactionStatus)}
              >
                <option value={TransactionStatus.SETTLED}>
                  {t('transactions.statuses.SETTLED')}
                </option>
                <option value={TransactionStatus.PENDING}>
                  {t('transactions.statuses.PENDING')}
                </option>
              </select>
            )}
          </Field>

          <Field label={`${t('transactions.notes')} (${t('common.optional')})`}>
            {({ id }) => (
              <Input id={id} value={notes} onChange={(event) => setNotes(event.target.value)} />
            )}
          </Field>

          {/* Comprovante so depois de o lancamento existir: o upload precisa
              do id para montar a chave do objeto. */}
          {editing ? (
            <div className="space-y-4 border-t border-border-subtle pt-4">
              {/* So despesa se divide: transferencia nem despesa e' (regra 4). */}
              {editing.type === TransactionType.EXPENSE && (
                <SplitPanel
                  transactionId={editing.id}
                  amountInCents={editing.amountInCents}
                  onChanged={onSaved}
                />
              )}

              <AttachmentsPanel transactionId={editing.id} />
            </div>
          ) : (
            <p className="border-t border-border-subtle pt-4 text-xs text-content-subtle">
              {t('attachments.saveFirst')}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" full onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button full disabled={save.isPending || invalid} onClick={() => save.mutate()}>
              {save.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
