/**
 * @finapp/ui
 *
 * Componentes compartilhados. Consumido como FONTE pelo Vite -- nao ha step de
 * build -- para o Tailwind escanear as classes e o HMR funcionar sem rebuild.
 *
 * Regra que vale para todos: cor sai de TOKEN semantico (`bg-surface`,
 * `text-content-muted`), nunca de cor fixa do Tailwind.
 */

export { cn } from './lib/cn.js';
export { Button, type ButtonProps } from './components/button.js';
export { Field, Input, type FieldProps, type InputProps } from './components/field.js';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card.js';
export { ProgressBar, Stepper, type ProgressBarProps, type StepperProps } from './components/progress.js';
export { Alert, type AlertProps } from './components/alert.js';
