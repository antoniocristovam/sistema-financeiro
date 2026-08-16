import { type Account, type Goal } from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Card, CardContent, Field, Input, ProgressBar } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { MoneyInput } from '../../components/money-input';
import { PageHeader } from '../../components/page-header';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';

const CURRENCY = 'BRL';

/**
 * Metas.
 *
 * Cada cartao responde "nesse ritmo, quando eu chego la?". Quando nao ha
 * ritmo, a resposta e' silencio -- inventar uma data seria pior do que admitir
 * que ainda nao da para saber.
 */
export function GoalsPage() {
  const { t, tag } = useTranslation();
  const { goals, accounts } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['goals', activeId],
    queryFn: () => goals.list(activeId!),
    enabled: activeId !== null,
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts', activeId, false],
    queryFn: () => accounts.list(activeId!),
    enabled: activeId !== null,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['goals', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['accounts', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['transactions', activeId] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => goals.remove(activeId!, id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const items = query.data?.items ?? [];
  const usable = (accountsQuery.data?.accounts ?? []).filter(
    (account) => account.archivedAt === null && account.type !== 'CREDIT_CARD',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('goals.title')}
        subtitle={t('goals.subtitle')}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('goals.new')}
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {query.isPending ? (
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Target className="mx-auto h-8 w-8 text-content-subtle" aria-hidden />
            <p className="mt-3 text-sm text-content-muted">{t('goals.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              locale={tag}
              onContribute={() => setContributing(goal)}
              onDelete={() => {
                if (confirm(t('goals.deleteConfirm'))) {
                  remove.mutate(goal.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {creating && (
        <GoalDialog
          accounts={usable}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}

      {contributing && (
        <ContributionDialog
          goal={contributing}
          accounts={usable.filter((account) => account.id !== contributing.linkedAccountId)}
          onClose={() => setContributing(null)}
          onSaved={() => {
            setContributing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function GoalCard({
  goal,
  locale,
  onContribute,
  onDelete,
}: {
  goal: Goal;
  locale: string;
  onContribute: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const money = (cents: number): string =>
    formatMoney(Money.fromCents(cents, CURRENCY), { locale });

  const percent = Math.min(100, Math.floor(goal.basisPoints / 100));

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate text-sm font-medium text-content">
              {goal.achievedAt !== null && (
                <Check className="h-4 w-4 shrink-0 text-income" aria-hidden />
              )}
              {goal.name}
            </p>
            <p className="mt-0.5 text-xs text-content-subtle">
              {money(goal.savedInCents)} {t('budgets.of')} {money(goal.targetAmountInCents)}
              {goal.linkedAccountName && <> · {goal.linkedAccountName}</>}
            </p>
          </div>

          <Button variant="ghost" size="icon" aria-label={t('common.delete')} onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-danger" aria-hidden />
          </Button>
        </div>

        <ProgressBar percent={percent} />

        <div className="space-y-0.5 text-xs text-content-muted">
          <p>{t('goals.percentDone', { percent })}</p>

          {/* Sem ritmo nao ha projecao: e' o silencio deliberado. */}
          {goal.estimatedCompletion ? (
            <p>
              {t('goals.estimated', { month: goal.estimatedCompletion })}
              {goal.monthlyAverageInCents > 0 && (
                <> · {t('goals.pace', { value: money(goal.monthlyAverageInCents) })}</>
              )}
            </p>
          ) : goal.achievedAt === null ? (
            <p className="text-content-subtle">{t('goals.noPace')}</p>
          ) : null}

          {goal.deadline && goal.requiredMonthlyInCents !== null && (
            <p className={goal.isOnTrack === false ? 'text-danger' : undefined}>
              {t('goals.required', {
                value: money(goal.requiredMonthlyInCents),
                date: goal.deadline,
              })}
            </p>
          )}
        </div>

        <Button variant="secondary" size="sm" full onClick={onContribute}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('goals.contribute')}
        </Button>
      </CardContent>
    </Card>
  );
}

function GoalDialog({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { goals } = useDependencies();
  const { activeId } = useWorkspace();

  const [name, setName] = useState('');
  const [target, setTarget] = useState(0);
  const [deadline, setDeadline] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      goals.create(activeId!, {
        name: name.trim(),
        targetAmountInCents: target,
        deadline: deadline || null,
        icon: null,
        color: null,
        linkedAccountId: linkedAccountId || null,
      }),
    onSuccess: onSaved,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium text-content">{t('goals.new')}</p>

          {error && <Alert tone="danger">{error}</Alert>}

          <Field label={t('goals.name')} required>
            {({ id }) => (
              <Input
                id={id}
                autoFocus
                placeholder={t('goals.namePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          <Field label={t('goals.target')} required>
            {({ id }) => (
              <MoneyInput
                id={id}
                valueInCents={target}
                onChange={setTarget}
                currency={CURRENCY}
              />
            )}
          </Field>

          <Field label={`${t('goals.deadline')} (${t('common.optional')})`}>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            )}
          </Field>

          <Field label={`${t('goals.linkedAccount')} (${t('common.optional')})`}>
            {({ id }) => (
              <select
                id={id}
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                value={linkedAccountId}
                onChange={(event) => setLinkedAccountId(event.target.value)}
              >
                <option value="">{t('goals.noLinkedAccount')}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {/* A diferenca entre "guardar de verdade" e "anotar o progresso". */}
          <p className="text-xs text-content-subtle">{t('goals.linkedAccountHint')}</p>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" full onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              full
              disabled={save.isPending || name.trim() === '' || target <= 0}
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

function ContributionDialog({
  goal,
  accounts,
  onClose,
  onSaved,
}: {
  goal: Goal;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { goals } = useDependencies();
  const { activeId } = useWorkspace();

  const [amount, setAmount] = useState(0);
  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const linked = goal.linkedAccountId !== null;

  const save = useMutation({
    mutationFn: () =>
      goals.contribute(activeId!, goal.id, {
        amountInCents: amount,
        ...(note.trim() ? { note: note.trim() } : {}),
        // Origem so faz sentido com conta vinculada: sem ela, o aporte e' um
        // registro de progresso e nenhum saldo muda.
        ...(linked ? { fromAccountId } : {}),
      }),
    onSuccess: onSaved,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium text-content">
            {t('goals.contribute')} · {goal.name}
          </p>

          {error && <Alert tone="danger">{error}</Alert>}

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

          {linked ? (
            <Field label={t('goals.fromAccount')} required>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                  value={fromAccountId}
                  onChange={(event) => setFromAccountId(event.target.value)}
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
            <p className="text-xs text-content-subtle">{t('goals.registerOnly')}</p>
          )}

          <Field label={`${t('transactions.notes')} (${t('common.optional')})`}>
            {({ id }) => (
              <Input id={id} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
          </Field>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" full onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              full
              disabled={save.isPending || amount <= 0 || (linked && fromAccountId === '')}
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
