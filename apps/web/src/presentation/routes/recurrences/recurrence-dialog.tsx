import {
  MAX_REMINDER_DAYS_BEFORE,
  RecurrenceFrequency,
  TransactionType,
  type Account,
  type Category,
  type Recurrence,
} from '@finapp/contracts';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@finapp/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { MoneyInput } from '../../components/money-input';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';

/**
 * Chaves dos dias da semana, na ordem do indice (0 = domingo).
 *
 * Uma lista explicita em vez de `recurrences.weekdays.${n}`: a chave montada em
 * tempo de execucao escapa da checagem de tipo do dicionario, e uma traducao
 * faltando so apareceria na tela do usuario.
 */
const WEEKDAY_KEYS = [
  'recurrences.weekdays.sunday',
  'recurrences.weekdays.monday',
  'recurrences.weekdays.tuesday',
  'recurrences.weekdays.wednesday',
  'recurrences.weekdays.thursday',
  'recurrences.weekdays.friday',
  'recurrences.weekdays.saturday',
] as const;

function today(): string {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Formulario da conta fixa.
 *
 * Os campos de periodicidade aparecem conforme a frequencia -- semanal usa dia
 * da SEMANA, mensal e anual usam dia do MES. Mandar os dois juntos e' recusado
 * pelo contrato, entao a tela nem oferece a combinacao.
 */
export function RecurrenceDialog({
  editing,
  accounts,
  categories,
  currency,
  onClose,
  onSaved,
}: {
  editing: Recurrence | null;
  accounts: Account[];
  categories: Category[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { recurrences } = useDependencies();
  const { activeId } = useWorkspace();

  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<'INCOME' | 'EXPENSE'>(editing?.template.type ?? 'EXPENSE');
  const [accountId, setAccountId] = useState(
    editing?.template.accountId ?? accounts[0]?.id ?? '',
  );
  const [categoryId, setCategoryId] = useState(editing?.template.categoryId ?? '');
  const [amount, setAmount] = useState(editing?.template.amountInCents ?? 0);
  const [description, setDescription] = useState(editing?.template.description ?? '');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    editing?.frequency ?? RecurrenceFrequency.MONTHLY,
  );
  const [interval, setInterval] = useState(editing?.interval ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(editing?.dayOfMonth ?? new Date().getDate());
  const [weekday, setWeekday] = useState(editing?.weekday ?? 1);
  const [monthOfYear, setMonthOfYear] = useState(editing?.monthOfYear ?? 1);
  const [startDate, setStartDate] = useState(editing?.startDate ?? today());
  const [endDate, setEndDate] = useState(editing?.endDate ?? '');
  const [reminder, setReminder] = useState<number | null>(editing?.reminderDaysBefore ?? 3);
  const [error, setError] = useState<string | null>(null);

  const isWeekly = frequency === RecurrenceFrequency.WEEKLY;
  const isYearly = frequency === RecurrenceFrequency.YEARLY;

  const options = categories.filter(
    (category) => category.archivedAt === null && category.type === type,
  );

  const save = useMutation({
    mutationFn: async () => {
      const schedule = {
        frequency,
        interval,
        // Cada frequencia manda SO o campo que lhe pertence: o contrato recusa
        // "todo dia 10, na terca-feira".
        dayOfMonth: isWeekly ? null : dayOfMonth,
        weekday: isWeekly ? weekday : null,
        monthOfYear: isYearly ? monthOfYear : null,
        startDate,
        endDate: endDate || null,
      };

      const template = {
        type,
        accountId,
        categoryId: categoryId || null,
        amountInCents: amount,
        description: description.trim(),
      };

      if (editing) {
        await recurrences.update(activeId!, editing.id, {
          name: name.trim(),
          template,
          schedule,
          reminderDaysBefore: reminder,
        });
        return;
      }

      await recurrences.create(activeId!, {
        name: name.trim(),
        template,
        ...schedule,
        reminderDaysBefore: reminder,
      });
    },
    onSuccess: onSaved,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const invalid =
    name.trim() === '' ||
    description.trim() === '' ||
    amount <= 0 ||
    accountId === '' ||
    startDate === '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="max-h-[90dvh] w-full max-w-md overflow-y-auto">
        <CardHeader>
          <CardTitle>{editing ? t('recurrences.edit') : t('recurrences.new')}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label={t('recurrences.name')} required>
            {({ id }) => (
              <Input
                id={id}
                autoFocus
                placeholder={t('recurrences.namePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          <Field label={t('recurrences.kind')}>
            {({ id }) => (
              <select
                id={id}
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as 'INCOME' | 'EXPENSE');
                  // A categoria antiga e' do outro tipo: o servidor recusaria.
                  setCategoryId('');
                }}
              >
                <option value={TransactionType.EXPENSE}>{t('transactions.expense')}</option>
                <option value={TransactionType.INCOME}>{t('transactions.income')}</option>
              </select>
            )}
          </Field>

          <Field label={t('transactions.description')} required>
            {({ id }) => (
              <Input
                id={id}
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

          <Field label={t('transactions.account')} required>
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

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('recurrences.frequency')}>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                  value={frequency}
                  onChange={(event) =>
                    setFrequency(event.target.value as RecurrenceFrequency)
                  }
                >
                  <option value={RecurrenceFrequency.WEEKLY}>
                    {t('recurrences.frequencies.WEEKLY')}
                  </option>
                  <option value={RecurrenceFrequency.MONTHLY}>
                    {t('recurrences.frequencies.MONTHLY')}
                  </option>
                  <option value={RecurrenceFrequency.YEARLY}>
                    {t('recurrences.frequencies.YEARLY')}
                  </option>
                </select>
              )}
            </Field>

            <Field label={t('recurrences.interval')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={52}
                  value={interval}
                  onChange={(event) => setInterval(Number(event.target.value) || 1)}
                />
              )}
            </Field>
          </div>

          {isWeekly ? (
            <Field label={t('recurrences.weekday')}>
              {({ id }) => (
                <select
                  id={id}
                  className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                  value={weekday}
                  onChange={(event) => setWeekday(Number(event.target.value))}
                >
                  {WEEKDAY_KEYS.map((key, value) => (
                    <option key={key} value={value}>
                      {t(key)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <div className={isYearly ? 'grid grid-cols-2 gap-3' : ''}>
              <Field label={t('recurrences.dayOfMonth')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={31}
                    value={dayOfMonth}
                    onChange={(event) => setDayOfMonth(Number(event.target.value) || 1)}
                  />
                )}
              </Field>

              {isYearly && (
                <Field label={t('recurrences.monthOfYear')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={12}
                      value={monthOfYear}
                      onChange={(event) => setMonthOfYear(Number(event.target.value) || 1)}
                    />
                  )}
                </Field>
              )}
            </div>
          )}

          {/* Dia 31 nao existe em fevereiro: a regra ajusta para o ultimo dia. */}
          {!isWeekly && dayOfMonth > 28 && (
            <p className="text-xs text-content-subtle">{t('recurrences.clampHint')}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('recurrences.startDate')} required>
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              )}
            </Field>

            <Field label={`${t('recurrences.endDate')} (${t('common.optional')})`}>
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label={t('recurrences.reminder')}>
            {({ id }) => (
              <select
                id={id}
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                value={reminder === null ? '' : String(reminder)}
                onChange={(event) =>
                  setReminder(event.target.value === '' ? null : Number(event.target.value))
                }
              >
                <option value="">{t('recurrences.noReminder')}</option>
                {[0, 1, 2, 3, 5, 7, 15, MAX_REMINDER_DAYS_BEFORE].map((days) => (
                  <option key={days} value={days}>
                    {days === 0
                      ? t('recurrences.reminderSameDay')
                      : days === 1
                        ? t('recurrences.reminderOneDay')
                        : t('recurrences.reminderOn', { days })}
                  </option>
                ))}
              </select>
            )}
          </Field>

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
