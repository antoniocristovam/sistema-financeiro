import { registerBodySchema, type RegisterBody } from '@finapp/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Field, Input } from '@finapp/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiRequestError } from '../../../infra/http/http-client';
import { AuthLayout } from '../../components/auth-layout';
import { useDependencies } from '../../providers/dependencies';
import { useTranslation } from '../../providers/locale-provider';
import { useSession } from '../../providers/session-provider';
import { messageFor } from './sign-in';

export function SignUpPage() {
  const { t } = useTranslation();
  const { auth } = useDependencies();
  const { setSession } = useSession();
  const navigate = useNavigate();

  const [formError, setFormError] = useState<string | null>(null);

  /**
   * O MESMO schema do servidor.
   *
   * A regra de senha ("8 caracteres, maiuscula e numero") existe em um lugar
   * so: `@finapp/contracts`. Reescrever no front cria duas regras que um dia
   * discordam -- e a que o usuario ve nao e' a que barra.
   */
  const form = useForm<RegisterBody>({
    resolver: zodResolver(registerBodySchema),
    defaultValues: { name: '', email: '', password: '' },
    mode: 'onBlur',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    try {
      const session = await auth.register(values);
      setSession(session);

      await navigate({ to: '/onboarding' });
    } catch (error) {
      // Erro de campo volta para o campo; o resto vira aviso no topo.
      if (error instanceof ApiRequestError) {
        const fields = error.fieldErrors();

        for (const [path, message] of Object.entries(fields)) {
          if (path === 'name' || path === 'email' || path === 'password') {
            form.setError(path, { message });
          }
        }

        if (error.code === 'EMAIL_ALREADY_USED') {
          form.setError('email', { message: t('errors.EMAIL_ALREADY_USED') });
          return;
        }

        if (Object.keys(fields).length > 0) {
          return;
        }
      }

      setFormError(messageFor(error, t));
    }
  });

  return (
    <AuthLayout
      title={t('auth.signUp.title')}
      subtitle={t('auth.signUp.subtitle')}
      footer={
        <>
          {t('auth.signUp.hasAccount')}{' '}
          <Link to="/entrar" className="font-medium text-brand hover:underline">
            {t('auth.signUp.signInLink')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Field label={t('auth.signUp.name')} error={form.formState.errors.name?.message} required>
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              autoComplete="name"
              autoFocus
              invalid={invalid}
              aria-describedby={describedBy}
              {...form.register('name')}
            />
          )}
        </Field>

        <Field label={t('auth.signUp.email')} error={form.formState.errors.email?.message} required>
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              invalid={invalid}
              aria-describedby={describedBy}
              {...form.register('email')}
            />
          )}
        </Field>

        <Field
          label={t('auth.signUp.password')}
          error={form.formState.errors.password?.message}
          hint={t('auth.signUp.passwordHint')}
          required
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              invalid={invalid}
              aria-describedby={describedBy}
              {...form.register('password')}
            />
          )}
        </Field>

        <Button type="submit" full disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('common.loading') : t('auth.signUp.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
