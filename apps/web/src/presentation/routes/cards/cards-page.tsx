import {
  InvoiceStatus,
  type CreditCardSummary,
  type Invoice,
  type InvoiceItem,
} from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Card, CardContent, ProgressBar, cn } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard as CreditCardIcon, Plus } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '../../components/page-header';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation, type TranslationKey } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';
import { InstallmentDialog } from './installment-dialog';

const CURRENCY = 'BRL';

/**
 * Cartoes e faturas.
 *
 * A tela existe para responder tres perguntas, nesta ordem: quanto ja gastei
 * neste ciclo, quanto ainda posso gastar, e o que preciso pagar. O resto (o
 * detalhe item a item) fica a um clique de distancia.
 */
export function CardsPage() {
  const { t, tag } = useTranslation();
  const { cards, accounts, categories } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [installmentCard, setInstallmentCard] = useState<CreditCardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['cards', activeId],
    queryFn: () => cards.list(activeId!),
    enabled: activeId !== null,
  });

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

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['cards', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['transactions', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['accounts', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['invoice'] });
  };

  const list = query.data?.cards ?? [];

  // Cartao nao paga cartao: so contas comuns aparecem como origem.
  const payableFrom = (accountsQuery.data?.accounts ?? []).filter(
    (account) => account.archivedAt === null && account.type !== 'CREDIT_CARD',
  );

  const allCategories = [
    ...(categoriesQuery.data?.expenses ?? []),
  ].flatMap((parent) => [parent, ...parent.children]);

  return (
    <div className="space-y-6">
      <PageHeader title={t('cards.title')} subtitle={t('cards.subtitle')} />

      {error && <Alert tone="danger">{error}</Alert>}

      {query.isPending ? (
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <CreditCardIcon className="mx-auto h-8 w-8 text-content-subtle" aria-hidden />
            <p className="mt-3 text-sm text-content-muted">{t('cards.empty')}</p>
            <p className="mt-1 text-xs text-content-subtle">{t('cards.emptyHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((card) => (
            <CardPanel
              key={card.accountId}
              card={card}
              locale={tag}
              payableFrom={payableFrom}
              openInvoiceId={openInvoiceId}
              onToggleInvoice={(id) =>
                setOpenInvoiceId((current) => (current === id ? null : id))
              }
              onInstallment={() => setInstallmentCard(card)}
              onError={setError}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}

      {installmentCard && (
        <InstallmentDialog
          card={installmentCard}
          categories={allCategories}
          currency={CURRENCY}
          onClose={() => setInstallmentCard(null)}
          onSaved={() => {
            setInstallmentCard(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function CardPanel({
  card,
  locale,
  payableFrom,
  openInvoiceId,
  onToggleInvoice,
  onInstallment,
  onError,
  onChanged,
}: {
  card: CreditCardSummary;
  locale: string;
  payableFrom: { id: string; name: string }[];
  openInvoiceId: string | null;
  onToggleInvoice: (id: string) => void;
  onInstallment: () => void;
  onError: (message: string | null) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { cards } = useDependencies();
  const { activeId } = useWorkspace();

  const pay = useMutation({
    mutationFn: ({ invoiceId, fromAccountId }: { invoiceId: string; fromAccountId: string }) =>
      cards.pay(activeId!, invoiceId, { fromAccountId }),
    onSuccess: () => {
      onError(null);
      onChanged();
    },
    onError: (cause) => onError(messageFor(cause, t)),
  });

  const money = (cents: number): string =>
    formatMoney(Money.fromCents(cents, CURRENCY), { locale });

  // Barra do limite: usada / total. Estourado fica em 100% e vermelho.
  const usedPercent =
    card.limitInCents > 0
      ? Math.min(100, Math.floor((card.usedLimitInCents * 100) / card.limitInCents))
      : 0;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-content">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: card.color ?? 'var(--color-brand)' }}
                aria-hidden
              />
              {card.name}
            </p>
            <p className="mt-0.5 text-xs text-content-subtle">
              {t('cards.cycle', { closing: card.closingDay, due: card.dueDay })}
            </p>
          </div>

          <Button variant="secondary" size="sm" onClick={onInstallment}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('cards.newInstallment')}
          </Button>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-content-muted">
              {t('cards.used')} <span className="tabular">{money(card.usedLimitInCents)}</span>
            </span>
            <span className="text-content-subtle">
              {t('cards.available')}{' '}
              <span className="tabular">{money(card.availableLimitInCents)}</span>
            </span>
          </div>

          <ProgressBar percent={usedPercent} />
        </div>

        {card.openInvoice && (
          <InvoiceRow
            invoice={card.openInvoice}
            locale={locale}
            expanded={openInvoiceId === card.openInvoice.id}
            onToggle={() => onToggleInvoice(card.openInvoice!.id)}
          />
        )}

        {card.unpaidInvoices.map((invoice) => (
          <div key={invoice.id} className="space-y-2">
            <InvoiceRow
              invoice={invoice}
              locale={locale}
              expanded={openInvoiceId === invoice.id}
              onToggle={() => onToggleInvoice(invoice.id)}
            />

            {/* So fatura FECHADA pode ser paga: aberta ainda muda de valor. */}
            <div className="flex flex-wrap items-center gap-2 pl-3">
              <span className="text-xs text-content-subtle">{t('cards.payWith')}</span>

              {payableFrom.map((account) => (
                <Button
                  key={account.id}
                  variant="secondary"
                  size="sm"
                  disabled={pay.isPending}
                  onClick={() => {
                    if (confirm(t('cards.payConfirm', { account: account.name }))) {
                      pay.mutate({ invoiceId: invoice.id, fromAccountId: account.id });
                    }
                  }}
                >
                  {account.name}
                </Button>
              ))}
            </div>
          </div>
        ))}

        {!card.openInvoice && card.unpaidInvoices.length === 0 && (
          <p className="text-xs text-content-subtle">{t('cards.nothingOpen')}</p>
        )}

        {/*
          Historico.
          Sem ele, a fatura desaparecia da tela no instante em que era paga --
          e o usuario nao tinha onde conferir o que acabou de pagar.
        */}
        <InvoiceHistory
          cardId={card.accountId}
          locale={locale}
          openInvoiceId={openInvoiceId}
          onToggleInvoice={onToggleInvoice}
        />
      </CardContent>
    </Card>
  );
}

function InvoiceHistory({
  cardId,
  locale,
  openInvoiceId,
  onToggleInvoice,
}: {
  cardId: string;
  locale: string;
  openInvoiceId: string | null;
  onToggleInvoice: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { cards } = useDependencies();
  const { activeId } = useWorkspace();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ['card-invoices', activeId, cardId],
    queryFn: () => cards.invoices(activeId!, cardId, 6),
    // So consulta quando alguem abre: a maioria das visitas nunca olha o
    // historico, e seis meses de fatura por cartao nao sao de graca.
    enabled: activeId !== null && open,
  });

  // As em aberto ja aparecem acima; aqui interessa o que ja foi quitado.
  const paid = (query.data ?? []).filter((invoice) => invoice.status === InvoiceStatus.PAID);

  return (
    <div className="pt-1">
      <button
        type="button"
        className="text-xs text-content-subtle hover:text-content hover:underline"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t('cards.hideHistory') : t('cards.showHistory')}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {query.isPending ? (
            <p className="text-xs text-content-muted">{t('common.loading')}</p>
          ) : paid.length === 0 ? (
            <p className="text-xs text-content-subtle">{t('cards.noHistory')}</p>
          ) : (
            paid.map((invoice) => (
              <InvoiceRow
                key={invoice.id}
                invoice={invoice}
                locale={locale}
                expanded={openInvoiceId === invoice.id}
                onToggle={() => onToggleInvoice(invoice.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function InvoiceRow({
  invoice,
  locale,
  expanded,
  onToggle,
}: {
  invoice: Invoice;
  locale: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-border-subtle">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-raised"
      >
        <span className="min-w-0">
          <span className="block text-sm text-content">{invoice.referenceMonth}</span>
          <span className="block text-xs text-content-subtle">
            {t('cards.closesOn', { date: invoice.closingDate })} ·{' '}
            {t('cards.dueOn', { date: invoice.dueDate })}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px]',
              invoice.isOverdue
                ? 'bg-danger-subtle text-danger'
                : 'bg-surface-sunken text-content-muted',
            )}
          >
            {invoice.isOverdue
              ? t('cards.statuses.OVERDUE')
              : t(`cards.statuses.${invoice.status}` as TranslationKey)}
          </span>

          <span className="tabular text-sm font-semibold text-content">
            {formatMoney(Money.fromCents(invoice.totalInCents, CURRENCY), { locale })}
          </span>
        </span>
      </button>

      {expanded && <InvoiceItems invoiceId={invoice.id} locale={locale} />}
    </div>
  );
}

function InvoiceItems({ invoiceId, locale }: { invoiceId: string; locale: string }) {
  const { t } = useTranslation();
  const { cards } = useDependencies();
  const { activeId } = useWorkspace();

  const query = useQuery({
    queryKey: ['invoice', activeId, invoiceId],
    queryFn: () => cards.invoice(activeId!, invoiceId),
    enabled: activeId !== null,
  });

  const items = query.data?.items ?? [];

  return (
    <div className="border-t border-border-subtle px-3 py-2">
      {query.isPending ? (
        <p className="text-xs text-content-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-content-subtle">{t('cards.noItems')}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item: InvoiceItem) => (
            <li key={item.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 flex-1 truncate text-content-muted">
                {item.description}
                {/* Rotulo da parcela: sem ele, doze linhas iguais no extrato. */}
                {item.installmentNumber !== null && item.installmentTotal !== null && (
                  <span className="ml-1 text-content-subtle">
                    {item.installmentNumber}/{item.installmentTotal}
                  </span>
                )}
                {item.category && (
                  <span className="ml-1 text-content-subtle">· {item.category.name}</span>
                )}
              </span>

              <span className="tabular shrink-0 text-content-muted">{item.date.slice(5)}</span>
              <span className="tabular shrink-0 text-content">
                {formatMoney(Money.fromCents(item.amountInCents, CURRENCY), { locale })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { InvoiceStatus };
