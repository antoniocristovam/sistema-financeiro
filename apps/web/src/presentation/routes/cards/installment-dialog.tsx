import {
  MAX_INSTALLMENTS,
  splitInstallments,
  type Category,
  type CreditCardSummary,
} from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@finapp/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { MoneyInput } from '../../components/money-input';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';

function today(): string {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Compra parcelada.
 *
 * O usuario informa o TOTAL -- e' o numero da maquininha, e o que ele lembra.
 * A previa mostra as parcelas ja com a distribuicao de centavos aplicada, o
 * mesmo calculo que o servidor fara: R$ 100,00 em 3x vira 33,34 / 33,33 /
 * 33,33, e nao tres vezes 33,33 (que somariam R$ 99,99).
 */
export function InstallmentDialog({
  card,
  categories,
  currency,
  onClose,
  onSaved,
}: {
  card: CreditCardSummary;
  categories: Category[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tag } = useTranslation();
  const { cards } = useDependencies();
  const { activeId } = useWorkspace();

  const [description, setDescription] = useState('');
  const [total, setTotal] = useState(0);
  const [installments, setInstallments] = useState(2);
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      cards.installments(activeId!, {
        cardAccountId: card.accountId,
        categoryId: categoryId || null,
        totalAmountInCents: total,
        installments,
        date,
        description: description.trim(),
      }),
    onSuccess: onSaved,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const parcelas = total > 0 ? splitInstallments(total, installments) : [];
  const first = parcelas[0];
  const last = parcelas.at(-1);
  const money = (cents: number): string =>
    formatMoney(Money.fromCents(cents, currency), { locale: tag });

  const invalid = description.trim() === '' || total <= 0 || date === '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center">
      <Card className="max-h-[90dvh] w-full max-w-md overflow-y-auto">
        <CardHeader>
          <CardTitle>{t('cards.newInstallment')}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <p className="text-xs text-content-subtle">{card.name}</p>

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

          <Field label={t('cards.totalAmount')} required>
            {({ id }) => (
              <MoneyInput
                id={id}
                valueInCents={total}
                onChange={setTotal}
                currency={currency}
              />
            )}
          </Field>

          <Field label={t('cards.installments')} required>
            {({ id }) => (
              <select
                id={id}
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm text-content"
                value={installments}
                onChange={(event) => setInstallments(Number(event.target.value))}
              >
                {Array.from({ length: MAX_INSTALLMENTS - 1 }, (_, index) => index + 2).map(
                  (value) => (
                    <option key={value} value={value}>
                      {value}x
                    </option>
                  ),
                )}
              </select>
            )}
          </Field>

          <Field label={t('cards.purchaseDate')} required>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
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
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.parentId ? `— ${category.name}` : category.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {/* Previa com o MESMO calculo do servidor. */}
          {parcelas.length > 0 && (
            <div className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-content-muted">
              {first === last ? (
                <p className="tabular">
                  {installments}x {money(first!)}
                </p>
              ) : (
                <p className="tabular">
                  {t('cards.installmentPreview', {
                    first: money(first!),
                    rest: `${installments - 1}x ${money(last!)}`,
                  })}
                </p>
              )}
              <p className="mt-0.5 text-content-subtle">
                {t('cards.installmentTotal', { total: money(total) })}
              </p>
            </div>
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
