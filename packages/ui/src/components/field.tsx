import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid === true ? true : undefined}
      className={cn(
        'h-10 w-full rounded-lg border bg-surface px-3 text-sm text-content outline-none transition-colors',
        'placeholder:text-content-subtle focus-visible:ring-2 focus-visible:ring-brand',
        invalid === true ? 'border-danger' : 'border-border-subtle',
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = 'Input';

export interface FieldProps {
  label: string;
  /** Mensagem de erro. Quando presente, o campo fica marcado como invalido. */
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; invalid: boolean; describedBy: string | undefined }) => ReactNode;
}

/**
 * Rotulo + controle + erro, com os `aria-*` amarrados.
 *
 * O `id` e o `aria-describedby` sao gerados aqui e passados por render prop.
 * Deixar isso a cargo de cada tela e' como se perde acessibilidade: um campo
 * sem `label` associado nao e' anunciado pelo leitor de tela, e o erro nao e'
 * lido quando aparece.
 */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-content">
        {label}
        {required === true && <span className="ml-0.5 text-danger">*</span>}
      </label>

      {children({ id, invalid: Boolean(error), describedBy })}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-content-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
