import { AccountType } from '@finapp/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@finapp/ui';
import { formatMoney, Money } from '@finapp/money';
import { useQuery } from '@tanstack/react-query';

import { useDependencies } from '../providers/dependencies';
import { useTranslation, type TranslationKey } from '../providers/locale-provider';
import { useSession } from '../providers/session-provider';

/**
 * Rotulo do tipo de conta.
 *
 * `CREDIT_CARD` nao esta no dicionario do onboarding (o passo 2 nao o oferece),
 * entao tem tratamento proprio em vez de vazar o enum cru para a tela.
 */
function accountTypeLabel(type: AccountType, t: (key: TranslationKey) => string): string {
  if (type === AccountType.CREDIT_CARD) {
    return t('onboarding.steps.cards');
  }

  return t(`onboarding.account.types.${type}` as TranslationKey);
}

/**
 * Dashboard minimo.
 *
 * Fecha a fatia vertical da fase 5: cadastro -> onboarding -> uma tela que le
 * de volta o que foi configurado. O dashboard de verdade chega na fase 13.
 */
export function DashboardPage() {
  const { t, tag } = useTranslation();
  const { onboarding } = useDependencies();
  const { user, workspaceId, signOut } = useSession();

  const stateQuery = useQuery({
    queryKey: ['onboarding', workspaceId],
    queryFn: () => onboarding.state(workspaceId!),
    enabled: workspaceId !== null,
  });

  const state = stateQuery.data;

  return (
    <main className="min-h-dvh bg-canvas p-4 sm:p-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              {t('common.appName')}
            </p>
            <h1 className="text-2xl font-semibold text-content">{t('dashboard.title')}</h1>
          </div>

          <Button variant="ghost" onClick={() => void signOut()}>
            {t('auth.signOut')}
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{user?.name}</CardTitle>
            <CardDescription>{t('dashboard.placeholder')}</CardDescription>
          </CardHeader>

          {state && (
            <CardContent className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-surface-sunken p-3">
                  <dt className="text-xs text-content-muted">{t('onboarding.income.amount')}</dt>
                  <dd className="text-lg font-semibold tabular text-content">
                    {formatMoney(
                      Money.fromCents(state.monthlyIncomeInCents, state.baseCurrency),
                      { locale: tag },
                    )}
                  </dd>
                </div>

                <div className="rounded-lg bg-surface-sunken p-3">
                  <dt className="text-xs text-content-muted">
                    {t('onboarding.savings.percent')}
                  </dt>
                  <dd className="text-lg font-semibold tabular text-content">
                    {state.savingsTargetPercent === null
                      ? '—'
                      : `${(state.savingsTargetPercent / 100).toFixed(0)}%`}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2">
                {state.accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between rounded-lg border border-border-subtle p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-content">{account.name}</p>
                      <p className="text-xs text-content-subtle">
                        {account.institution ?? accountTypeLabel(account.type, t)}
                      </p>
                    </div>

                    <p className="tabular text-sm font-semibold text-content">
                      {formatMoney(
                        Money.fromCents(account.initialBalanceInCents, state.baseCurrency),
                        { locale: tag },
                      )}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-content-subtle">
                {state.selectedCategoryKeys.length} {t('onboarding.steps.categories').toLowerCase()}
              </p>
            </CardContent>
          )}
        </Card>
      </div>
    </main>
  );
}
