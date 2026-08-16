import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@finapp/ui';
import { type ReactNode } from 'react';

import { useTranslation } from '../providers/locale-provider';

export interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Moldura das telas de entrada: cadastro, login e recuperacao de senha. */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-center text-sm font-semibold tracking-wide text-brand uppercase">
          {t('common.appName')}
        </p>

        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>

        {footer && <div className="text-center text-sm text-content-muted">{footer}</div>}
      </div>
    </main>
  );
}
