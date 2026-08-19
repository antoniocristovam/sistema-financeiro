import { type Account, type SplitBalance } from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Card, CardContent, Field, Input, cn } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, HandCoins, Users } from 'lucide-react';
import { useState } from 'react';

import { MoneyInput } from '../../components/money-input';
import { PageHeader } from '../../components/page-header';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';

const CURRENCY = 'BRL';

/**
 * Divisoes e acertos.
 *
 * O numero de cada pessoa e' LIQUIDO: o que ela me deve menos o que eu devo a
 * ela. Duas colunas separadas fariam o usuario subtrair de cabeca, e e'
 * exatamente essa compensacao que evita dois pagamentos cruzados.
 */
export function SplitsPage() {
  const { t, tag } = useTranslation();
  const { splits, accounts } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [settling, setSettling] = useState<SplitBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const balancesQuery = useQuery({
    queryKey: ['split-balances', activeId],
    queryFn: () => splits.balances(activeId!),
    enabled: activeId !== null,
  });

  const settlementsQuery = useQuery({
    queryKey: ['settlements', activeId],
    queryFn: () => splits.settlements(activeId!),
    enabled: activeId !== null,
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts', activeId, false],
    queryFn: () => accounts.list(activeId!),
    enabled: activeId !== null,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['split-balances', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['settlements', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['transactions', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['accounts', activeId] });
  };

  const money = (cents: number): string =>
    formatMoney(Money.fromCents(cents, CURRENCY), { locale: tag });

  const balances = balancesQuery.data?.balances ?? [];
  const settlements = settlementsQuery.data?.items ?? [];
  const usable = (accountsQuery.data?.accounts ?? []).filter(
    (account) => account.archivedAt === null && account.type !== 'CREDIT_CARD',
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('splits.pageTitle')} subtitle={t('splits.pageSubtitle')} />

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-content-subtle">{t('splits.toReceive')}</p>
            <p className="tabular text-2xl font-semibold text-income">
              {money(balancesQuery.data?.totalToReceiveInCents ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-content-subtle">{t('splits.toPay')}</p>
            <p className="tabular text-2xl font-semibold text-expense">
              {money(balancesQuery.data?.totalToPayInCents ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {balancesQuery.isPending ? (
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      ) : balances.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Users className="mx-auto h-8 w-8 text-content-subtle" aria-hidden />
            <p className="mt-3 text-sm text-content-muted">{t('splits.noBalances')}</p>
            <p className="mt-1 text-xs text-content-subtle">{t('splits.noBalancesHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {balances.map((balance) => (
            <li key={balance.participantKey}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-content">
                      {balance.participantName}
                    </p>
                    <p className="mt-0.5 text-xs text-content-subtle">
                      {t('splits.pendingCount', { count: balance.pendingSplitCount })}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'tabular text-sm font-semibold',
                        balance.netInCents >= 0 ? 'text-income' : 'text-expense',
                      )}
                    >
                      {balance.netInCents >= 0
                        ? t('splits.owesMe', { value: money(balance.netInCents) })
                        : t('splits.iOwe', { value: money(-balance.netInCents) })}
                    </span>

                    <Button variant="secondary" size="sm" onClick={() => setSettling(balance)}>
                      <HandCoins className="h-4 w-4" aria-hidden />
                      {t('splits.settle')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {settlements.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <h2 className="flex items-center gap-2 text-sm font-medium text-content">
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
              {t('splits.history')}
            </h2>

            <ul className="space-y-1">
              {settlements.map((settlement) => (
                <li
                  key={settlement.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 truncate text-content-muted">
                    {settlement.fromName} → {settlement.toName}
                    {settlement.note && (
                      <span className="text-content-subtle"> · {settlement.note}</span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-content-subtle">{settlement.date}</span>
                    <span className="tabular text-content">
                      {money(settlement.amountInCents)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {settling && (
        <SettlementDialog
          balance={settling}
          accounts={usable}
          onClose={() => setSettling(null)}
          onSaved={() => {
            setSettling(null);
            setError(null);
            invalidate();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function SettlementDialog({
  balance,
  accounts,
  onClose,
  onSaved,
  onError,
}: {
  balance: SplitBalance;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const { splits } = useDependencies();
  const { activeId } = useWorkspace();

  // O sinal do saldo ja diz a direcao: quem recebe e quem paga.
  const direction = balance.netInCents >= 0 ? 'RECEIVED' : 'PAID';

  const [amount, setAmount] = useState(Math.abs(balance.netInCents));
  const [note, setNote] = useState('');
  const [registerTransaction, setRegisterTransaction] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');

  const save = useMutation({
    mutationFn: () =>
      splits.settle(activeId!, {
        participantKey: balance.participantKey,
        ...(balance.participantUserId
          ? { participantUserId: balance.participantUserId }
          : {}),
        participantName: balance.participantName,
        ...(balance.participantEmail ? { participantEmail: balance.participantEmail } : {}),
        amountInCents: amount,
        direction,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(registerTransaction ? { accountId } : {}),
        createTransaction: registerTransaction,
      }),
    onSuccess: onSaved,
    onError: (cause) => onError(messageFor(cause, t)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium text-content">
            {direction === 'RECEIVED'
              ? t('splits.receiveFrom', { name: balance.participantName })
              : t('splits.payTo', { name: balance.participantName })}
          </p>

          <Field label={t('transactions.amount')} required>
            {({ id }) => (
              <MoneyInput
                id={id}
                valueInCents={amount}
                onChange={setAmount}
                currency={CURRENCY}
              />
            )}
          </Field>

          <Field label={`${t('transactions.notes')} (${t('common.optional')})`}>
            {({ id }) => (
              <Input id={id} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm text-content-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border-subtle"
              checked={registerTransaction}
              onChange={(event) => setRegisterTransaction(event.target.checked)}
            />
            {t('splits.registerTransaction')}
          </label>

          {/* Acerto em especie nao pode inventar movimento numa conta. */}
          {registerTransaction ? (
            <Field label={t('splits.account')} required>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <p className="text-xs text-content-subtle">{t('splits.noTransactionHint')}</p>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" full onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              full
              disabled={
                save.isPending || amount <= 0 || (registerTransaction && accountId === '')
              }
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
