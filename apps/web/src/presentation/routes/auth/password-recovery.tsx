import { forgotPasswordBodySchema, resetPasswordBodySchema } from '@finapp/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Field, Input } from '@finapp/ui';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { AuthLayout } from '../../components/auth-layout';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { messageFor } from './sign-in';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { auth } = useDependencies();
  const [sent, setSent] = useState(false);

  const form = useForm<{ email: string }>({
    resolver: zodResolver(forgotPasswordBodySchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await auth.requestPasswordReset(values.email);

    // Confirmacao IGUAL exista o e-mail ou nao: a rota nao pode virar um
    // verificador de cadastro aberto ao publico.
    setSent(true);
  });

  return (
    <AuthLayout
      title={t('auth.forgotPassword.title')}
      subtitle={sent ? undefined : t('auth.forgotPassword.subtitle')}
      footer={
        <Link to="/entrar" className="font-medium text-brand hover:underline">
          {t('auth.forgotPassword.backToSignIn')}
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">{t('auth.forgotPassword.sent')}</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('auth.forgotPassword.email')} error={form.formState.errors.email?.message}>
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

          <Button type="submit" full disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('common.loading') : t('auth.forgotPassword.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

interface ResetForm {
  token: string;
  password: string;
  passwordConfirmation: string;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { auth } = useDependencies();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { token?: string };

  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<ResetForm>({
    resolver: zodResolver(resetPasswordBodySchema),
    defaultValues: { token: search.token ?? '', password: '', passwordConfirmation: '' },
  });

  useEffect(() => {
    form.setValue('token', search.token ?? '');
  }, [search.token, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    try {
      await auth.resetPassword(values);
      setDone(true);
    } catch (error) {
      setFormError(messageFor(error, t));
    }
  });

  if (done) {
    return (
      <AuthLayout title={t('auth.resetPassword.title')}>
        <div className="space-y-4">
          <Alert tone="success">{t('auth.resetPassword.success')}</Alert>
          <Button full onClick={() => void navigate({ to: '/entrar' })}>
            {t('auth.signIn.submit')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.resetPassword.title')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        {!search.token && <Alert tone="danger">{t('auth.resetPassword.invalidLink')}</Alert>}

        <Field
          label={t('auth.resetPassword.password')}
          error={form.formState.errors.password?.message}
          hint={t('auth.signUp.passwordHint')}
          required
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              autoFocus
              invalid={invalid}
              aria-describedby={describedBy}
              {...form.register('password')}
            />
          )}
        </Field>

        <Field
          label={t('auth.resetPassword.passwordConfirmation')}
          error={form.formState.errors.passwordConfirmation?.message}
          required
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              invalid={invalid}
              aria-describedby={describedBy}
              {...form.register('passwordConfirmation')}
            />
          )}
        </Field>

        <Button type="submit" full disabled={form.formState.isSubmitting || !search.token}>
          {form.formState.isSubmitting ? t('common.loading') : t('auth.resetPassword.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { auth } = useDependencies();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { token?: string };

  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');

  useEffect(() => {
    if (!search.token) {
      setState('failed');
      return;
    }

    let cancelled = false;

    void auth
      .verifyEmail(search.token)
      .then(() => !cancelled && setState('done'))
      .catch(() => !cancelled && setState('failed'));

    return () => {
      cancelled = true;
    };
  }, [auth, search.token]);

  return (
    <AuthLayout title={t('auth.verifyEmail.title')}>
      <div className="space-y-4">
        {state === 'working' && <p className="text-sm text-content-muted">{t('common.loading')}</p>}
        {state === 'done' && <Alert tone="success">{t('auth.verifyEmail.success')}</Alert>}
        {state === 'failed' && <Alert tone="danger">{t('auth.verifyEmail.error')}</Alert>}

        {state !== 'working' && (
          <Button full onClick={() => void navigate({ to: '/' })}>
            {t('auth.verifyEmail.goToApp')}
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}
