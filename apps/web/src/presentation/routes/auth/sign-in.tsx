import { loginBodySchema, type LoginBody } from '@finapp/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Field, Input } from '@finapp/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiRequestError } from '../../../infra/http/http-client';
import { AuthLayout } from '../../components/auth-layout';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation, type TranslationKey } from '../../providers/locale-provider';
import { useSession } from '../../providers/session-provider';

export function SignInPage() {
  const { t } = useTranslation();
  const { auth } = useDependencies();
  const { setSession } = useSession();
  const navigate = useNavigate();

  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginBody>({
    resolver: zodResolver(loginBodySchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    try {
      const session = await auth.signIn(values);
      setSession(session);

      // Quem ainda nao terminou o wizard cai nele; o guard da raiz confirma.
      await navigate({
        to: session.user.onboardingCompletedAt === null ? '/onboarding' : '/dashboard',
      });
    } catch (error) {
      setFormError(messageFor(error, t));
    }
  });

  return (
    <AuthLayout
      title={t('auth.signIn.title')}
      subtitle={t('auth.signIn.subtitle')}
      footer={
        <>
          {t('auth.signIn.noAccount')}{' '}
          <Link to="/criar-conta" className="font-medium text-brand hover:underline">
            {t('auth.signIn.signUpLink')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Field label={t('auth.signIn.email')} error={form.formState.errors.email?.message}>
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              autoFocus
              invalid={invalid}
              aria-describedby={describedBy}
              {...form.register('email')}
            />
          )}
        </Field>

        <Field label={t('auth.signIn.password')} error={form.formState.errors.password?.message}>
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              invalid={invalid}
              aria-describedby={describedBy}
              {...form.register('password')}
            />
          )}
        </Field>

        <div className="text-right">
          <Link to="/esqueci-senha" className="text-xs text-content-muted hover:text-brand">
            {t('auth.signIn.forgotPassword')}
          </Link>
        </div>

        <Button type="submit" full disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('common.loading') : t('auth.signIn.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * Erro da API traduzido pelo CODIGO, nunca pela mensagem.
 *
 * A mensagem do servidor muda com o idioma dele; o codigo e' estavel. Um
 * codigo desconhecido cai na mensagem generica em vez de vazar texto cru.
 */
export function messageFor(
  error: unknown,
  t: (key: TranslationKey) => string,
): string {
  if (error instanceof ApiRequestError) {
    const key = `errors.${error.code}` as TranslationKey;
    const translated = t(key);

    return translated === key ? t('common.genericError') : translated;
  }

  return t('common.genericError');
}
