import { formatMoney, Money, parseLocalizedDecimal } from '@finapp/money';
import { Input } from '@finapp/ui';
import { useEffect, useState } from 'react';

import { useTranslation } from '../providers/locale-provider';

export interface MoneyInputProps {
  /** Valor em CENTAVOS. O componente nunca expoe decimal para fora. */
  valueInCents: number;
  onChange: (valueInCents: number) => void;
  currency: string;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  allowNegative?: boolean;
  placeholder?: string;
}

/**
 * Campo de dinheiro.
 *
 * Fala CENTAVOS com o resto do app e texto com o usuario. A conversao passa
 * pelo `@finapp/money`, entao "1.234,56" digitado por um brasileiro e
 * "1,234.56" digitado por um americano chegam no mesmo inteiro -- e nenhum dos
 * dois vira 1234.5600000000001.
 *
 * O texto so e' reformatado no BLUR. Reformatar a cada tecla move o cursor
 * para o fim e torna impossivel corrigir um digito no meio do numero.
 */
export function MoneyInput({
  valueInCents,
  onChange,
  currency,
  id,
  invalid,
  describedBy,
  allowNegative = false,
  placeholder,
}: MoneyInputProps) {
  const { tag } = useTranslation();
  const [text, setText] = useState(() => display(valueInCents, currency, tag));

  // Reflete mudanca vinda de fora (retomada do wizard, reset do formulario).
  useEffect(() => {
    setText(display(valueInCents, currency, tag));
  }, [valueInCents, currency, tag]);

  const commit = (raw: string): void => {
    const normalized = parseLocalizedDecimal(raw, tag);

    if (normalized === null) {
      onChange(0);
      setText(display(0, currency, tag));
      return;
    }

    const parsed = Money.fromDecimal(normalized, currency);
    const cents = allowNegative ? parsed.toCents() : Math.abs(parsed.toCents());

    onChange(cents);
    setText(display(cents, currency, tag));
  };

  return (
    <Input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      invalid={invalid}
      aria-describedby={describedBy}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      className="tabular"
    />
  );
}

function display(cents: number, currency: string, locale: string): string {
  return formatMoney(Money.fromCents(cents, currency), { locale, display: 'none' });
}
