import {
  ONBOARDING_TOTAL_STEPS,
  OnboardingStep,
  type CategoriesStepBody,
  type CreditCardsStepBody,
  type FirstAccountStepBody,
  type IncomeStepBody,
  type SavingsTargetStepBody,
} from '@finapp/contracts';
import { Alert, Button, Card, CardContent, CardHeader, Stepper } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { useDependencies } from '../../providers/dependencies';
import { useTranslation, type TranslationKey } from '../../providers/locale-provider';
import { useSession } from '../../providers/session-provider';
import { messageFor } from '../auth/sign-in';
import { AccountStep, CardsStep, CategoriesStep, IncomeStep, SavingsStep } from './steps';

const STEP_TITLES: Record<number, { title: TranslationKey; subtitle: TranslationKey }> = {
  [OnboardingStep.INCOME]: {
    title: 'onboarding.income.title',
    subtitle: 'onboarding.income.subtitle',
  },
  [OnboardingStep.FIRST_ACCOUNT]: {
    title: 'onboarding.account.title',
    subtitle: 'onboarding.account.subtitle',
  },
  [OnboardingStep.CREDIT_CARDS]: {
    title: 'onboarding.cards.title',
    subtitle: 'onboarding.cards.subtitle',
  },
  [OnboardingStep.CATEGORIES]: {
    title: 'onboarding.categories.title',
    subtitle: 'onboarding.categories.subtitle',
  },
  [OnboardingStep.SAVINGS_TARGET]: {
    title: 'onboarding.savings.title',
    subtitle: 'onboarding.savings.subtitle',
  },
};

/**
 * Wizard de onboarding.
 *
 * O passo atual vem do SERVIDOR (`completedStep + 1`), nao de estado local:
 * e' isso que o torna retomavel em outro dispositivo, e nao so em outra aba.
 *
 * O usuario pode VOLTAR para revisar sem perder progresso -- o passo concluido
 * no servidor nunca retrocede, entao rever o passo 1 nao apaga o 4.
 */
export function OnboardingPage() {
  const { t } = useTranslation();
  const { onboarding, auth } = useDependencies();
  const { workspaceId, setUser } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [visitedStep, setVisitedStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stateQuery = useQuery({
    queryKey: ['onboarding', workspaceId],
    queryFn: () => onboarding.state(workspaceId!),
    enabled: workspaceId !== null,
  });

  const catalogQuery = useQuery({
    queryKey: ['onboarding', 'seeds'],
    queryFn: () => onboarding.seedCategories(workspaceId!),
    enabled: workspaceId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const state = stateQuery.data;
  const serverStep = Math.min((state?.completedStep ?? 0) + 1, ONBOARDING_TOTAL_STEPS);
  const step = visitedStep ?? serverStep;

  const saveStep = useMutation({
    mutationFn: async (payload: unknown) => {
      if (!workspaceId) {
        return;
      }

      switch (step) {
        case OnboardingStep.INCOME:
          await onboarding.saveIncome(workspaceId, payload as IncomeStepBody);
          break;
        case OnboardingStep.FIRST_ACCOUNT:
          // `null` = a conta ja existe (retomada); so avanca.
          if (payload !== null) {
            await onboarding.createAccount(workspaceId, payload as FirstAccountStepBody);
          }
          break;
        case OnboardingStep.CREDIT_CARDS:
          await onboarding.saveCreditCards(workspaceId, payload as CreditCardsStepBody);
          break;
        case OnboardingStep.CATEGORIES:
          await onboarding.saveCategories(workspaceId, payload as CategoriesStepBody);
          break;
        case OnboardingStep.SAVINGS_TARGET:
          await onboarding.saveSavingsTarget(workspaceId, payload as SavingsTargetStepBody);
          await onboarding.complete(workspaceId);
          break;
      }
    },
    onSuccess: async () => {
      setError(null);

      if (step === OnboardingStep.SAVINGS_TARGET) {
        // Invalida ANTES de navegar: o dashboard usa a mesma query key, e sem
        // isso ele pinta o cache anterior ao passo 5 -- a meta de economia
        // aparece vazia em uma tela que acabou de recebe-la.
        await queryClient.invalidateQueries({ queryKey: ['onboarding', workspaceId] });

        // O `onboardingCompletedAt` mudou: recarrega o usuario para o guard da
        // raiz parar de mandar todo mundo de volta para o wizard.
        setUser(await auth.me());
        await navigate({ to: '/dashboard' });
        return;
      }

      setVisitedStep(step + 1);
      await queryClient.invalidateQueries({ queryKey: ['onboarding', workspaceId] });
    },
    onError: (cause) => setError(messageFor(cause, t)),
  });

  if (stateQuery.isPending || catalogQuery.isPending || !state) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas">
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      </main>
    );
  }

  const labels = STEP_TITLES[step];
  const canGoBack = step > 1;

  return (
    <main className="flex min-h-dvh items-start justify-center bg-canvas p-4 sm:items-center">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-3">
          <p className="text-center text-sm font-semibold tracking-wide text-brand uppercase">
            {t('common.appName')}
          </p>

          <Stepper
            current={step}
            total={ONBOARDING_TOTAL_STEPS}
            label={t('onboarding.stepLabel', { current: step, total: ONBOARDING_TOTAL_STEPS })}
          />

          <p className="text-center text-xs text-content-subtle">
            {t('onboarding.stepLabel', { current: step, total: ONBOARDING_TOTAL_STEPS })}
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-2">
              {canGoBack && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.back')}
                  onClick={() => setVisitedStep(step - 1)}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Button>
              )}

              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-semibold text-content">
                  {labels ? t(labels.title) : ''}
                </h1>
                <p className="mt-1 text-sm text-content-muted">
                  {labels ? t(labels.subtitle) : ''}
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}

            {step === OnboardingStep.INCOME && (
              <IncomeStep
                state={state}
                onSubmit={(payload) => saveStep.mutateAsync(payload)}
                submitting={saveStep.isPending}
              />
            )}

            {step === OnboardingStep.FIRST_ACCOUNT && (
              <AccountStep
                state={state}
                onSubmit={(payload) => saveStep.mutateAsync(payload)}
                submitting={saveStep.isPending}
              />
            )}

            {step === OnboardingStep.CREDIT_CARDS && (
              <CardsStep
                state={state}
                onSubmit={(payload) => saveStep.mutateAsync(payload)}
                submitting={saveStep.isPending}
              />
            )}

            {step === OnboardingStep.CATEGORIES && (
              <CategoriesStep
                state={state}
                catalog={catalogQuery.data?.categories ?? []}
                onSubmit={(payload) => saveStep.mutateAsync(payload)}
                submitting={saveStep.isPending}
              />
            )}

            {step === OnboardingStep.SAVINGS_TARGET && (
              <SavingsStep
                state={state}
                onSubmit={(payload) => saveStep.mutateAsync(payload)}
                submitting={saveStep.isPending}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
