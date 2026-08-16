import { cn } from '../lib/cn.js';

export interface StepperProps {
  current: number;
  total: number;
  /** Rotulo acessivel: "Passo 2 de 5". */
  label: string;
}

/**
 * Progresso do wizard.
 *
 * `role="progressbar"` com os valores do ARIA: sem isso, o leitor de tela ve
 * uma fileira de divs coloridas e o usuario nao sabe em que passo esta.
 */
export function Stepper({ current, total, label }: StepperProps) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={label}
      className="flex items-center gap-1.5"
    >
      {Array.from({ length: total }, (_, index) => index + 1).map((step) => (
        <span
          key={step}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            step < current && 'bg-brand',
            step === current && 'bg-brand',
            step > current && 'bg-border-subtle',
          )}
        />
      ))}
    </div>
  );
}

export interface ProgressBarProps {
  /** 0 a 100. */
  percent: number;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
  className?: string;
}

export function ProgressBar({ percent, tone = 'brand', className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));

  const toneClass = {
    brand: 'bg-brand',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }[tone];

  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-sunken', className)}>
      <div
        className={cn('h-full rounded-full transition-[width]', toneClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
