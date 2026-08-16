import { type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface AlertProps {
  tone?: 'info' | 'danger' | 'success';
  children: ReactNode;
  className?: string;
}

/**
 * Aviso em bloco.
 *
 * `role="alert"` no tom de erro para o leitor de tela anunciar assim que
 * aparece -- e' o caso de "e-mail ou senha incorretos", que o usuario precisa
 * ouvir sem ir procurar.
 */
export function Alert({ tone = 'info', children, className }: AlertProps) {
  const toneClass = {
    info: 'bg-surface-sunken text-content-muted border-border-subtle',
    danger: 'bg-expense-surface text-expense border-expense/30',
    success: 'bg-income-surface text-income border-income/30',
  }[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn('rounded-lg border px-3 py-2 text-sm', toneClass, className)}
    >
      {children}
    </div>
  );
}
