import { AccountType, type Account, type CreateAccountBody } from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { MoneyInput } from '../../components/money-input';
import { PageHeader } from '../../components/page-header';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation, type TranslationKey } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';

const TYPES = [
  AccountType.CHECKING,
  AccountType.SAVINGS,
  AccountType.CASH,
  AccountType.INVESTMENT,
  AccountType.CREDIT_CARD,
] as const;

export function AccountsPage() {
  const { t, tag } = useTranslation();
  const { accounts } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['accounts', activeId, showArchived],
    queryFn: () => accounts.list(activeId!, showArchived),
    enabled: activeId !== null,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['accounts', activeId] });

  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      accounts.archive(activeId!, id, archived),
    onSuccess: invalidate,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => accounts.remove(activeId!, id),
    onSuccess: () => {
      setError(null);
      return invalidate();
    },
    // A API recusa excluir conta com lancamento e explica o porque: a mensagem
    // dela e melhor do que qualquer texto generico que eu inventasse aqui.
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const list = query.data?.accounts ?? [];
  const currency = 'BRL';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('accounts.new')}
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-content-muted">
            {t('accounts.total')}
          </CardTitle>
          <p className="tabular text-3xl font-semibold text-content">
            {formatMoney(
              Money.fromCents(query.data?.totalBalanceInCents ?? 0, currency),
              { locale: tag },
            )}
          </p>
          <p className="text-xs text-content-subtle">{t('accounts.totalHint')}</p>
        </CardHeader>
      </Card>

      <label className="flex items-center gap-2 text-sm text-content-muted">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-brand)]"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        {t('accounts.showArchived')}
      </label>

      {query.isPending ? (
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-content-subtle">{t('accounts.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((account) => (
            <li key={account.id}>
              <Card className={cn('p-4', account.archivedAt && 'opacity-60')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: account.color ?? 'var(--color-border-strong)' }}
                      />
                      <p className="truncate font-medium text-content">{account.name}</p>
                      {account.archivedAt && (
                        <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-content-subtle">
                          {t('accounts.archived')}
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-xs text-content-subtle">
                      {account.institution ??
                        t(`onboarding.account.types.${account.type}` as TranslationKey)}
                      {' · '}
                      {t('accounts.transactionCount', { count: account.transactionCount })}
                    </p>

                    {account.creditCard && (
                      <p className="mt-1 text-xs text-content-subtle">
                        {t('accounts.limit')}:{' '}
                        {formatMoney(
                          Money.fromCents(account.creditCard.limitInCents, currency),
                          { locale: tag },
                        )}
                        {' · '}
                        {t('accounts.closingDay')} {account.creditCard.closingDay}
                        {' · '}
                        {t('accounts.dueDay')} {account.creditCard.dueDay}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p
                        className={cn(
                          'tabular font-semibold',
                          account.balanceInCents < 0 ? 'text-expense' : 'text-content',
                        )}
                      >
                        {formatMoney(Money.fromCents(account.balanceInCents, currency), {
                          locale: tag,
                        })}
                      </p>

                      {account.projectedBalanceInCents !== account.balanceInCents && (
                        <p
                          className="tabular text-xs text-content-subtle"
                          title={t('accounts.projectedHint')}
                        >
                          {t('accounts.projected')}:{' '}
                          {formatMoney(
                            Money.fromCents(account.projectedBalanceInCents, currency),
                            { locale: tag },
                          )}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('accounts.edit')}
                        onClick={() => setEditing(account)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={
                          account.archivedAt ? t('accounts.unarchive') : t('accounts.archive')
                        }
                        onClick={() =>
                          archive.mutate({
                            id: account.id,
                            archived: account.archivedAt === null,
                          })
                        }
                      >
                        {account.archivedAt ? (
                          <ArchiveRestore className="h-4 w-4" aria-hidden />
                        ) : (
                          <Archive className="h-4 w-4" aria-hidden />
                        )}
                      </Button>

                      {/* Excluir so aparece quando a conta esta vazia: oferecer
                          e falhar depois e pior do que nao oferecer. */}
                      {account.transactionCount === 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('accounts.delete')}
                          onClick={() => {
                            if (confirm(t('accounts.deleteConfirm'))) {
                              remove.mutate(account.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-danger" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <AccountDialog
          account={editing}
          currency={currency}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void invalidate();
          }}
        />
      )}
    </div>
  );
}

function AccountDialog({
  account,
  currency,
  onClose,
  onSaved,
}: {
  account: Account | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { accounts } = useDependencies();
  const { activeId } = useWorkspace();

  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? AccountType.CHECKING);
  const [balance, setBalance] = useState(account?.initialBalanceInCents ?? 0);
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [limit, setLimit] = useState(account?.creditCard?.limitInCents ?? 0);
  const [closingDay, setClosingDay] = useState(String(account?.creditCard?.closingDay ?? ''));
  const [dueDay, setDueDay] = useState(String(account?.creditCard?.dueDay ?? ''));
  const [error, setError] = useState<string | null>(null);

  const isCard = type === AccountType.CREDIT_CARD;
  const sameDay = isCard && closingDay !== '' && closingDay === dueDay;

  const save = useMutation({
    mutationFn: async () => {
      const creditCard = isCard
        ? {
            limitInCents: limit,
            closingDay: Number(closingDay),
            dueDay: Number(dueDay),
          }
        : undefined;

      if (account) {
        await accounts.update(activeId!, account.id, {
          name: name.trim(),
          institution: institution.trim() || null,
          ...(isCard ? {} : { initialBalanceInCents: balance }),
          ...(creditCard ? { creditCard } : {}),
        });
        return;
      }

      const body: CreateAccountBody = {
        name: name.trim(),
        type,
        initialBalanceInCents: balance,
        ...(institution.trim() ? { institution: institution.trim() } : {}),
        ...(creditCard ? { creditCard } : {}),
      } as CreateAccountBody;

      await accounts.create(activeId!, body);
    },
    onSuccess: onSaved,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{account ? t('accounts.edit') : t('accounts.new')}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label={t('accounts.name')} required>
            {({ id }) => (
              <Input
                id={id}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          {/* O TIPO nao muda na edicao: trocar conta corrente por cartao mudaria
              a semantica de todo lancamento ja gravado nela. */}
          {!account && (
            <Field label={t('accounts.type')} required>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  value={type}
                  onChange={(event) => setType(event.target.value as AccountType)}
                >
                  {TYPES.map((option) => (
                    <option key={option} value={option}>
                      {option === AccountType.CREDIT_CARD
                        ? t('nav.cards')
                        : t(`onboarding.account.types.${option}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {!isCard && (
            <Field label={t('accounts.initialBalance')}>
              {({ id }) => (
                <MoneyInput
                  id={id}
                  valueInCents={balance}
                  onChange={setBalance}
                  currency={currency}
                  allowNegative
                />
              )}
            </Field>
          )}

          {isCard && (
            <>
              <Field label={t('accounts.limit')}>
                {({ id }) => (
                  <MoneyInput
                    id={id}
                    valueInCents={limit}
                    onChange={setLimit}
                    currency={currency}
                  />
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('accounts.closingDay')} required>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={31}
                      value={closingDay}
                      onChange={(event) => setClosingDay(event.target.value)}
                    />
                  )}
                </Field>

                <Field
                  label={t('accounts.dueDay')}
                  required
                  error={sameDay ? t('onboarding.cards.sameDayError') : undefined}
                >
                  {({ id, invalid }) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={31}
                      invalid={invalid}
                      value={dueDay}
                      onChange={(event) => setDueDay(event.target.value)}
                    />
                  )}
                </Field>
              </div>
            </>
          )}

          <Field label={`${t('accounts.institution')} (${t('common.optional')})`}>
            {({ id }) => (
              <Input
                id={id}
                value={institution}
                onChange={(event) => setInstitution(event.target.value)}
              />
            )}
          </Field>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" full onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              full
              disabled={
                save.isPending ||
                name.trim() === '' ||
                sameDay ||
                (isCard && (closingDay === '' || dueDay === ''))
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
