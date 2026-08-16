import {
  AccountType,
  type CreditCardsStepBody,
  type OnboardingState,
  type SeedCategory,
} from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Field, Input } from '@finapp/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { MoneyInput } from '../../components/money-input';
import { useTranslation, type TranslationKey } from '../../providers/locale-provider';

export interface StepProps {
  state: OnboardingState;
  onSubmit: (payload: unknown) => Promise<void>;
  submitting: boolean;
}

// -- Passo 1: renda -----------------------------------------------------------

export function IncomeStep({ state, onSubmit, submitting }: StepProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(state.monthlyIncomeInCents);
  const [payday, setPayday] = useState<string>(state.payday === null ? '' : String(state.payday));

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          monthlyIncomeInCents: amount,
          payday: payday === '' ? null : Number(payday),
        });
      }}
    >
      <Field label={t('onboarding.income.amount')} required>
        {({ id, describedBy }) => (
          <MoneyInput
            id={id}
            describedBy={describedBy}
            valueInCents={amount}
            onChange={setAmount}
            currency={state.baseCurrency}
          />
        )}
      </Field>

      <Field label={t('onboarding.income.payday')} hint={t('onboarding.income.paydayHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="number"
            min={1}
            max={31}
            inputMode="numeric"
            aria-describedby={describedBy}
            value={payday}
            onChange={(event) => setPayday(event.target.value)}
          />
        )}
      </Field>

      <Button type="submit" full disabled={submitting}>
        {submitting ? t('common.loading') : t('common.continue')}
      </Button>
    </form>
  );
}

// -- Passo 2: primeira conta --------------------------------------------------

const ACCOUNT_TYPES = [
  AccountType.CHECKING,
  AccountType.SAVINGS,
  AccountType.CASH,
  AccountType.INVESTMENT,
] as const;

export function AccountStep({ state, onSubmit, submitting }: StepProps) {
  const { t } = useTranslation();
  const existing = state.accounts.find((account) => account.type !== AccountType.CREDIT_CARD);

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]>(
    (existing?.type as (typeof ACCOUNT_TYPES)[number]) ?? AccountType.CHECKING,
  );
  const [balance, setBalance] = useState(existing?.initialBalanceInCents ?? 0);
  const [institution, setInstitution] = useState(existing?.institution ?? '');

  // Retomar o wizard com a conta ja criada nao pode criar uma segunda.
  if (existing) {
    return (
      <div className="space-y-5">
        <Alert tone="success">
          {existing.name} ·{' '}
          {formatMoney(Money.fromCents(existing.initialBalanceInCents, state.baseCurrency), {
            locale: 'pt-BR',
          })}
        </Alert>

        <Button full disabled={submitting} onClick={() => void onSubmit(null)}>
          {t('common.continue')}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          name,
          type,
          initialBalanceInCents: balance,
          ...(institution.trim() ? { institution: institution.trim() } : {}),
        });
      }}
    >
      <Field label={t('onboarding.account.name')} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            autoFocus
            required
            aria-describedby={describedBy}
            placeholder={t('onboarding.account.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>

      <Field label={t('onboarding.account.type')} required>
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-brand"
            value={type}
            onChange={(event) => setType(event.target.value as (typeof ACCOUNT_TYPES)[number])}
          >
            {ACCOUNT_TYPES.map((option) => (
              <option key={option} value={option}>
                {t(`onboarding.account.types.${option}` as TranslationKey)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label={t('onboarding.account.balance')} hint={t('onboarding.account.balanceHint')}>
        {({ id, describedBy }) => (
          <MoneyInput
            id={id}
            describedBy={describedBy}
            valueInCents={balance}
            onChange={setBalance}
            currency={state.baseCurrency}
            // Conta no vermelho e um estado legitimo de abertura.
            allowNegative
          />
        )}
      </Field>

      <Field label={`${t('onboarding.account.institution')} (${t('common.optional')})`}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            placeholder={t('onboarding.account.institutionPlaceholder')}
            value={institution}
            onChange={(event) => setInstitution(event.target.value)}
          />
        )}
      </Field>

      <Button type="submit" full disabled={submitting || name.trim() === ''}>
        {submitting ? t('common.loading') : t('common.continue')}
      </Button>
    </form>
  );
}

// -- Passo 3: cartoes ---------------------------------------------------------

interface CardDraft {
  name: string;
  limitInCents: number;
  closingDay: string;
  dueDay: string;
}

const emptyCard = (): CardDraft => ({ name: '', limitInCents: 0, closingDay: '', dueDay: '' });

export function CardsStep({ state, onSubmit, submitting }: StepProps) {
  const { t } = useTranslation();
  const existing = state.accounts.filter((account) => account.type === AccountType.CREDIT_CARD);

  const [cards, setCards] = useState<CardDraft[]>([]);

  const update = (index: number, patch: Partial<CardDraft>): void => {
    setCards((current) =>
      current.map((card, position) => (position === index ? { ...card, ...patch } : card)),
    );
  };

  const invalid = cards.some(
    (card) =>
      card.name.trim() === '' ||
      card.closingDay === '' ||
      card.dueDay === '' ||
      card.closingDay === card.dueDay,
  );

  const submit = (): void => {
    const payload: CreditCardsStepBody = {
      cards: cards.map((card) => ({
        name: card.name.trim(),
        limitInCents: card.limitInCents,
        closingDay: Number(card.closingDay),
        dueDay: Number(card.dueDay),
      })),
    };

    void onSubmit(payload);
  };

  return (
    <div className="space-y-5">
      {existing.length > 0 && (
        <Alert tone="success">
          {existing.map((card) => card.name).join(' · ')}
        </Alert>
      )}

      {cards.map((card, index) => (
        <div key={index} className="space-y-4 rounded-lg border border-border-subtle p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Field label={t('onboarding.cards.name')} required>
                {({ id }) => (
                  <Input
                    id={id}
                    placeholder={t('onboarding.cards.namePlaceholder')}
                    value={card.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                )}
              </Field>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="mt-6"
              aria-label={t('onboarding.cards.removeCard')}
              onClick={() => setCards((current) => current.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <Field label={t('onboarding.cards.limit')}>
            {({ id }) => (
              <MoneyInput
                id={id}
                valueInCents={card.limitInCents}
                onChange={(value) => update(index, { limitInCents: value })}
                currency={state.baseCurrency}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('onboarding.cards.closingDay')} required>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={31}
                  value={card.closingDay}
                  onChange={(event) => update(index, { closingDay: event.target.value })}
                />
              )}
            </Field>

            <Field
              label={t('onboarding.cards.dueDay')}
              required
              error={
                card.dueDay !== '' && card.dueDay === card.closingDay
                  ? t('onboarding.cards.sameDayError')
                  : undefined
              }
            >
              {({ id, invalid: fieldInvalid }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={31}
                  invalid={fieldInvalid}
                  value={card.dueDay}
                  onChange={(event) => update(index, { dueDay: event.target.value })}
                />
              )}
            </Field>
          </div>
        </div>
      ))}

      {cards.length === 0 && existing.length === 0 && (
        <p className="text-sm text-content-subtle">{t('onboarding.cards.empty')}</p>
      )}

      <Button
        variant="secondary"
        full
        onClick={() => setCards((current) => [...current, emptyCard()])}
      >
        <Plus className="h-4 w-4" aria-hidden />
        {t('onboarding.cards.addCard')}
      </Button>

      <Button type="button" full disabled={submitting || invalid} onClick={submit}>
        {submitting
          ? t('common.loading')
          : cards.length === 0
            ? t('common.skip')
            : t('common.continue')}
      </Button>
    </div>
  );
}

// -- Passo 4: categorias ------------------------------------------------------

export interface CategoriesStepProps extends StepProps {
  catalog: SeedCategory[];
}

export function CategoriesStep({ state, catalog, onSubmit, submitting }: CategoriesStepProps) {
  const { t } = useTranslation();

  // Pre-seleciona o que ja foi copiado, para a retomada mostrar a escolha.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(state.selectedCategoryKeys),
  );

  const toggle = (key: string): void => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  const expenses = catalog.filter((category) => category.type === 'EXPENSE');
  const income = catalog.filter((category) => category.type === 'INCOME');

  const renderGroup = (title: string, items: SeedCategory[]) => (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-semibold tracking-wide text-content-muted uppercase">
        {title}
      </legend>

      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((category) => {
          const checked = selected.has(category.systemKey);

          return (
            <label
              key={category.systemKey}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                checked
                  ? 'border-brand bg-surface-raised'
                  : 'border-border-subtle hover:bg-surface-raised'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
                checked={checked}
                onChange={() => toggle(category.systemKey)}
              />

              <span className="min-w-0">
                <span className="block text-sm font-medium text-content">{category.name}</span>
                {category.children.length > 0 && (
                  <span className="block truncate text-xs text-content-subtle">
                    {category.children.map((child) => child.name).join(', ')}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm">
        <span className="text-content-muted">
          {t('onboarding.categories.selectedCount', { count: selected.size })}
        </span>

        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(catalog.map((item) => item.systemKey)))}
          >
            {t('onboarding.categories.selectAll')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {t('onboarding.categories.clearAll')}
          </Button>
        </div>
      </div>

      <p className="text-xs text-content-subtle">{t('onboarding.categories.subcategoriesNote')}</p>

      {expenses.length > 0 && renderGroup(t('onboarding.categories.expenses'), expenses)}
      {income.length > 0 && renderGroup(t('onboarding.categories.income'), income)}

      {selected.size === 0 && <Alert tone="danger">{t('onboarding.categories.atLeastOne')}</Alert>}

      <Button
        full
        disabled={submitting || selected.size === 0}
        onClick={() => void onSubmit({ systemKeys: [...selected] })}
      >
        {submitting ? t('common.loading') : t('common.continue')}
      </Button>
    </div>
  );
}

// -- Passo 5: meta de economia ------------------------------------------------

export function SavingsStep({ state, onSubmit, submitting }: StepProps) {
  const { t, tag } = useTranslation();
  const [percent, setPercent] = useState<number>(
    state.savingsTargetPercent === null ? 20 : state.savingsTargetPercent / 100,
  );

  const income = Money.fromCents(state.monthlyIncomeInCents, state.baseCurrency);
  // Pontos-base: 20% e 2000. Percentual nunca trafega como float.
  const basisPoints = Math.round(percent * 100);
  const preview = income.percentage(basisPoints);

  return (
    <div className="space-y-6">
      <Field label={t('onboarding.savings.percent')}>
        {({ id }) => (
          <div className="space-y-3">
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              step={1}
              value={percent}
              onChange={(event) => setPercent(Number(event.target.value))}
              className="w-full accent-[var(--color-brand)]"
            />
            <output className="block text-center text-3xl font-semibold tabular text-content">
              {percent}%
            </output>
          </div>
        )}
      </Field>

      <p className="text-center text-sm text-content-muted">
        {state.monthlyIncomeInCents > 0
          ? t('onboarding.savings.preview', {
              amount: formatMoney(preview, { locale: tag }),
            })
          : t('onboarding.savings.noIncome')}
      </p>

      <div className="space-y-2">
        <Button
          full
          disabled={submitting}
          onClick={() => void onSubmit({ savingsTargetPercent: basisPoints })}
        >
          {submitting ? t('common.loading') : t('common.finish')}
        </Button>

        <Button
          variant="ghost"
          full
          disabled={submitting}
          onClick={() => void onSubmit({ savingsTargetPercent: null })}
        >
          {t('common.skip')}
        </Button>
      </div>
    </div>
  );
}
