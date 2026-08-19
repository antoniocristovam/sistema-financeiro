import { ShareType, splitAmountsClose, type SplitPayload } from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';
import { Alert, Button, Input, cn } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useDependencies } from '../providers/dependencies';
import { useTranslation } from '../providers/locale-provider';
import { useSession } from '../providers/session-provider';
import { useWorkspace } from '../providers/workspace-provider';
import { messageFor } from '../routes/auth/sign-in';

const CURRENCY = 'BRL';

interface Row {
  participantUserId?: string;
  name: string;
  email: string;
  /** PERCENT: pontos-base. FIXED: centavos. EQUAL: ignorado. */
  shareValue: number;
  isOwner: boolean;
}

/**
 * Divisao de uma despesa.
 *
 * A previa mostra os valores JA calculados como o servidor vai calcular --
 * inclusive a sobra de centavos, que vai para os primeiros participantes. Sem
 * a previa, o usuario so descobriria que R$ 100 em 3 nao da 33,33 tres vezes
 * depois de salvar.
 */
export function SplitPanel({
  transactionId,
  amountInCents,
  onChanged,
}: {
  transactionId: string;
  amountInCents: number;
  onChanged?: () => void;
}) {
  const { t, tag } = useTranslation();
  const { splits } = useDependencies();
  const { user } = useSession();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [shareType, setShareType] = useState<ShareType>(ShareType.EQUAL);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['splits', activeId, transactionId],
    queryFn: () => splits.get(activeId!, transactionId),
    enabled: activeId !== null,
  });

  const current = query.data;

  // Ao abrir a edicao, parte do que ja existe -- ou de mim mais uma pessoa.
  useEffect(() => {
    if (!editing) {
      return;
    }

    if (current && current.splits.length > 0) {
      setShareType(current.splits[0]!.shareType);
      setRows(
        current.splits.map((split) => ({
          ...(split.participantUserId ? { participantUserId: split.participantUserId } : {}),
          name: split.participantName,
          email: split.participantEmail ?? '',
          shareValue: split.shareValue ?? 0,
          isOwner: split.isOwner,
        })),
      );
      return;
    }

    setRows([
      {
        ...(user ? { participantUserId: user.id } : {}),
        name: user?.name ?? 'Eu',
        email: '',
        shareValue: 0,
        isOwner: true,
      },
      { name: '', email: '', shareValue: 0, isOwner: false },
    ]);
  }, [editing, current, user]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['splits', activeId, transactionId] });
    void queryClient.invalidateQueries({ queryKey: ['transactions', activeId] });
    // O orcamento passa a contar a minha parte, nao o valor cheio (regra 6).
    void queryClient.invalidateQueries({ queryKey: ['budgets', activeId] });
    void queryClient.invalidateQueries({ queryKey: ['split-balances', activeId] });
    onChanged?.();
  };

  const save = useMutation({
    mutationFn: () => {
      const payload: SplitPayload = {
        amountInCents,
        shareType,
        participants: rows.map((row) => ({
          ...(row.participantUserId ? { participantUserId: row.participantUserId } : {}),
          name: row.name.trim(),
          ...(row.email.trim() ? { email: row.email.trim() } : {}),
          ...(shareType === ShareType.EQUAL ? {} : { shareValue: row.shareValue }),
          isOwner: row.isOwner,
        })),
      };

      return splits.split(activeId!, transactionId, payload);
    },
    onSuccess: () => {
      setEditing(false);
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const remove = useMutation({
    mutationFn: () => splits.remove(activeId!, transactionId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const money = (cents: number): string =>
    formatMoney(Money.fromCents(cents, CURRENCY), { locale: tag });

  const preview = previewShares(amountInCents, shareType, rows);
  const closes = splitAmountsClose(amountInCents, preview);
  const namesFilled = rows.every((row) => row.name.trim() !== '');

  if (!editing) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-medium text-content">
            <Users className="h-4 w-4" aria-hidden />
            {t('splits.title')}
          </h3>

          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {current && current.splits.length > 0 ? t('common.edit') : t('splits.divide')}
          </Button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        {query.isPending ? (
          <p className="text-xs text-content-muted">{t('common.loading')}</p>
        ) : !current || current.splits.length === 0 ? (
          <p className="text-xs text-content-subtle">{t('splits.notShared')}</p>
        ) : (
          <>
            <ul className="space-y-1">
              {current.splits.map((split) => (
                <li key={split.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-content-muted">
                    {split.participantName}
                    {split.isOwner && (
                      <span className="ml-1 text-content-subtle">({t('splits.paidBy')})</span>
                    )}
                    {!split.isOwner && split.status === 'SETTLED' && (
                      <span className="ml-1 text-income">· {t('splits.settled')}</span>
                    )}
                  </span>
                  <span className="tabular shrink-0 text-content">
                    {money(split.amountInCents)}
                  </span>
                </li>
              ))}
            </ul>

            {/* O par de numeros que a regra 6 separa. */}
            <p className="text-xs text-content-subtle">
              {t('splits.mySharePreview', {
                mine: money(current.ownerShareInCents),
                total: money(current.amountInCents),
              })}
            </p>

            <Button variant="ghost" size="sm" onClick={() => remove.mutate()}>
              <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
              {t('splits.undo')}
            </Button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-content">{t('splits.title')}</h3>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex gap-2">
        {[ShareType.EQUAL, ShareType.PERCENT, ShareType.FIXED].map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setShareType(type)}
            className={cn(
              'rounded-lg border px-2 py-1 text-xs',
              shareType === type
                ? 'border-brand bg-surface-sunken text-content'
                : 'border-border-subtle text-content-muted',
            )}
          >
            {t(`splits.types.${type}` as 'splits.types.EQUAL')}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-0 flex-1"
              placeholder={t('splits.participantName')}
              value={row.name}
              onChange={(event) =>
                setRows((list) =>
                  list.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />

            {shareType !== ShareType.EQUAL && (
              <Input
                className="w-24"
                type="number"
                min={0}
                // PERCENT vai em pontos-base; FIXED, em centavos. Os dois sao
                // inteiros de proposito: e' o que faz a soma fechar.
                value={
                  shareType === ShareType.PERCENT
                    ? row.shareValue / 100
                    : row.shareValue / 100
                }
                onChange={(event) =>
                  setRows((list) =>
                    list.map((item, i) =>
                      i === index
                        ? { ...item, shareValue: Math.round(Number(event.target.value) * 100) }
                        : item,
                    ),
                  )
                }
              />
            )}

            <span className="tabular w-20 text-right text-xs text-content-muted">
              {money(preview[index] ?? 0)}
            </span>

            {!row.isOwner && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.delete')}
                onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          setRows((list) => [...list, { name: '', email: '', shareValue: 0, isOwner: false }])
        }
      >
        <Plus className="h-4 w-4" aria-hidden />
        {t('splits.addPerson')}
      </Button>

      {/* Regra 7 na tela: enquanto nao fechar, o botao nao salva. */}
      {!closes && (
        <p className="text-xs text-danger">
          {t('splits.doesNotClose', {
            sum: money(preview.reduce((a, b) => a + b, 0)),
            total: money(amountInCents),
          })}
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" full onClick={() => setEditing(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          full
          disabled={save.isPending || !closes || !namesFilled || rows.length < 2}
          onClick={() => save.mutate()}
        >
          {save.isPending ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </section>
  );
}

/**
 * Previa do rateio, com a MESMA regra do servidor.
 *
 * Maior-resto com desempate por indice: os primeiros participantes levam os
 * centavos de sobra. Se a previa usasse outra regra, o usuario veria um valor
 * na tela e outro depois de salvar.
 */
function previewShares(total: number, shareType: ShareType, rows: Row[]): number[] {
  if (rows.length === 0 || total <= 0) {
    return rows.map(() => 0);
  }

  if (shareType === ShareType.FIXED) {
    return rows.map((row) => row.shareValue);
  }

  const weights =
    shareType === ShareType.PERCENT ? rows.map((row) => row.shareValue) : rows.map(() => 1);

  const weightSum = weights.reduce((a, b) => a + b, 0);

  if (weightSum <= 0) {
    return rows.map(() => 0);
  }

  const base = weights.map((weight) => Math.floor((total * weight) / weightSum));
  let remainder = total - base.reduce((a, b) => a + b, 0);

  return base.map((value) => {
    if (remainder > 0) {
      remainder -= 1;

      return value + 1;
    }

    return value;
  });
}
