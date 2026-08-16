import {
  RecurrenceFrequency,
  type Recurrence,
  type RecurrenceOccurrence,
} from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Card, CardContent, cn } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Bell, BellOff, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '../../components/page-header';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation, type TranslationKey } from '../../providers/locale-provider';
import { useWorkspace } from '../../providers/workspace-provider';
import { messageFor } from '../auth/sign-in';
import { RecurrenceDialog } from './recurrence-dialog';

const CURRENCY = 'BRL';

/**
 * Contas fixas.
 *
 * A tela cadastra uma REGRA, nao lancamentos -- quem cria os lancamentos e' o
 * job diario, dentro de uma janela de 60 dias. Por isso a linha do tempo mostra
 * as duas naturezas juntas: o que ja virou lancamento e o que ainda vai virar.
 */
export function RecurrencesPage() {
  const { t, tag } = useTranslation();
  const { recurrences, accounts, categories } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialog, setDialog] = useState<{ editing: Recurrence | null } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['recurrences', activeId, includeInactive],
    queryFn: () => recurrences.list(activeId!, includeInactive),
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
    void queryClient.invalidateQueries({ queryKey: ['recurrences', activeId] });
    // O job materializa lancamentos: o extrato e os saldos mudam junto.
    void queryClient.invalidateQueries({ queryKey: ['transactions', activeId] });
  };

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      recurrences.update(activeId!, id, { isActive }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => recurrences.remove(activeId!, id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const items = query.data?.items ?? [];
  const committed = query.data?.monthlyCommittedInCents ?? 0;

  const accountList = (accountsQuery.data?.accounts ?? []).filter(
    (account) => account.archivedAt === null,
  );
  const categoryTree = categoriesQuery.data;
  const allCategories = [
    ...(categoryTree?.expenses ?? []),
    ...(categoryTree?.income ?? []),
  ].flatMap((parent) => [parent, ...parent.children]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('recurrences.title')}
        subtitle={t('recurrences.subtitle')}
        action={
          <Button
            disabled={accountList.length === 0}
            onClick={() => setDialog({ editing: null })}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('recurrences.new')}
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div>
            <p className="text-xs text-content-subtle">{t('recurrences.committed')}</p>
            <p className="tabular text-2xl font-semibold text-content">
              {formatMoney(Money.fromCents(committed, CURRENCY), { locale: tag })}
            </p>
            {/* A conta que mais engana: semanal nao e' 4x por mes. */}
            <p className="mt-1 text-xs text-content-subtle">{t('recurrences.committedHint')}</p>
          </div>

          <label className="flex items-center gap-2 text-sm text-content-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border-subtle"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            {t('recurrences.showInactive')}
          </label>
        </CardContent>
      </Card>

      {query.isPending ? (
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <CalendarClock className="mx-auto h-8 w-8 text-content-subtle" aria-hidden />
            <p className="mt-3 text-sm text-content-muted">{t('recurrences.empty')}</p>
            {accountList.length === 0 && (
              <p className="mt-1 text-xs text-content-subtle">
                {t('recurrences.needsAccount')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((recurrence) => (
            <li key={recurrence.id}>
              <RecurrenceCard
                recurrence={recurrence}
                expanded={expanded === recurrence.id}
                onToggleExpand={() =>
                  setExpanded((current) => (current === recurrence.id ? null : recurrence.id))
                }
                onEdit={() => setDialog({ editing: recurrence })}
                onToggleActive={() =>
                  toggle.mutate({ id: recurrence.id, isActive: !recurrence.isActive })
                }
                onDelete={() => {
                  if (confirm(t('recurrences.deleteConfirm'))) {
                    remove.mutate(recurrence.id);
                  }
                }}
                onSkipped={invalidate}
              />
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <RecurrenceDialog
          editing={dialog.editing}
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

function RecurrenceCard({
  recurrence,
  expanded,
  onToggleExpand,
  onEdit,
  onToggleActive,
  onDelete,
  onSkipped,
}: {
  recurrence: Recurrence;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onSkipped: () => void;
}) {
  const { t, tag } = useTranslation();
  const isIncome = recurrence.template.type === 'INCOME';

  return (
    <Card className={cn(!recurrence.isActive && 'opacity-60')}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={onToggleExpand}>
            <p className="truncate text-sm font-medium text-content">
              {recurrence.name}
              {!recurrence.isActive && (
                <span className="ml-2 text-xs text-content-subtle">
                  ({t('recurrences.inactive')})
                </span>
              )}
            </p>
            <p className="mt-0.5 truncate text-xs text-content-muted">
              {frequencyLabel(recurrence, t)} · {recurrence.template.accountName}
              {recurrence.template.categoryName
                ? ` · ${recurrence.template.categoryName}`
                : ''}
            </p>
            <p className="mt-0.5 text-xs text-content-subtle">
              {recurrence.nextOccurrence
                ? t('recurrences.next', { date: recurrence.nextOccurrence })
                : t('recurrences.finished')}
            </p>
          </button>

          <div className="flex items-center gap-2">
            <p
              className={cn(
                'tabular text-sm font-semibold',
                isIncome ? 'text-income' : 'text-expense',
              )}
            >
              {isIncome ? '+' : '-'}
              {formatMoney(
                Money.fromCents(recurrence.template.amountInCents, 'BRL'),
                { locale: tag },
              )}
            </p>

            <span title={reminderLabel(recurrence.reminderDaysBefore, t)}>
              {recurrence.reminderDaysBefore === null ? (
                <BellOff className="h-4 w-4 text-content-subtle" aria-hidden />
              ) : (
                <Bell className="h-4 w-4 text-brand" aria-hidden />
              )}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            {t('common.edit')}
          </Button>

          <Button variant="ghost" size="sm" onClick={onToggleActive}>
            {recurrence.isActive ? (
              <>
                <Pause className="h-4 w-4" aria-hidden />
                {t('recurrences.pause')}
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden />
                {t('recurrences.resume')}
              </>
            )}
          </Button>

          <Button variant="ghost" size="sm" onClick={onToggleExpand}>
            <CalendarClock className="h-4 w-4" aria-hidden />
            {t('recurrences.occurrences')}
          </Button>

          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-danger" aria-hidden />
            {t('common.delete')}
          </Button>
        </div>

        {expanded && <OccurrenceTimeline recurrence={recurrence} onSkipped={onSkipped} />}
      </CardContent>
    </Card>
  );
}

/**
 * Linha do tempo da serie.
 *
 * Mostra junto o que ja virou lancamento e o que ainda vai virar -- e' a unica
 * tela do app que exibe algo que ainda nao existe no banco.
 */
function OccurrenceTimeline({
  recurrence,
  onSkipped,
}: {
  recurrence: Recurrence;
  onSkipped: () => void;
}) {
  const { t } = useTranslation();
  const { recurrences } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['recurrence-occurrences', activeId, recurrence.id],
    queryFn: () => recurrences.occurrences(activeId!, recurrence.id),
    enabled: activeId !== null,
  });

  const skip = useMutation({
    mutationFn: (occurrenceDate: string) =>
      recurrences.skip(activeId!, recurrence.id, { occurrenceDate }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['recurrence-occurrences', activeId, recurrence.id],
      });
      onSkipped();
    },
  });

  const items = query.data ?? [];

  return (
    <div className="border-t border-border-subtle pt-3">
      {query.isPending ? (
        <p className="text-xs text-content-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-content-subtle">{t('recurrences.noOccurrences')}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((occurrence: RecurrenceOccurrence) => (
            <li
              key={occurrence.date}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    occurrence.status === 'SETTLED' && 'bg-income',
                    occurrence.status === 'MATERIALIZED' && 'bg-brand',
                    occurrence.status === 'SCHEDULED' && 'bg-border-subtle',
                    occurrence.status === 'SKIPPED' && 'bg-danger',
                  )}
                  aria-hidden
                />
                <span className="tabular text-content-muted">{occurrence.date}</span>
                <span className="text-content-subtle">
                  {t(`recurrences.status.${occurrence.status}` as TranslationKey)}
                </span>
              </span>

              {/* So faz sentido dispensar o que ainda nao virou lancamento. */}
              {occurrence.status === 'SCHEDULED' && (
                <button
                  type="button"
                  className="text-content-subtle hover:text-danger hover:underline"
                  disabled={skip.isPending}
                  onClick={() => skip.mutate(occurrence.date)}
                >
                  {t('recurrences.skip')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mesma frase do formulario, com o singular do dia resolvido. */
function reminderLabel(
  days: number | null,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  if (days === null) {
    return t('recurrences.noReminder');
  }

  if (days === 0) {
    return t('recurrences.reminderSameDay');
  }

  return days === 1
    ? t('recurrences.reminderOneDay')
    : t('recurrences.reminderOn', { days });
}

function frequencyLabel(
  recurrence: Recurrence,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  const every = recurrence.interval > 1 ? `${recurrence.interval}x ` : '';

  switch (recurrence.frequency) {
    case RecurrenceFrequency.WEEKLY:
      return `${every}${t('recurrences.frequencies.WEEKLY')}`;
    case RecurrenceFrequency.MONTHLY:
      return `${every}${t('recurrences.frequencies.MONTHLY')} · ${t('recurrences.onDay', { day: recurrence.dayOfMonth ?? 1 })}`;
    case RecurrenceFrequency.YEARLY:
      return `${every}${t('recurrences.frequencies.YEARLY')}`;
    default:
      return '';
  }
}
