import { Money } from '@finapp/money';

/** Faixas da barra de progresso. Verde ate 79%, ambar 80-99%, vermelho >= 100%. */
export type BudgetBand = 'OK' | 'NEAR' | 'OVER';

/** Limiares que geram notificacao, uma vez cada, por mes. */
export const BUDGET_ALERT_THRESHOLDS = [80, 100] as const;
export type BudgetThreshold = (typeof BUDGET_ALERT_THRESHOLDS)[number];

/**
 * Consumo de um orcamento no mes.
 *
 * Duas armadilhas moram aqui:
 *
 * 1. O consumo usa a MINHA PARTE em despesas divididas, nunca o valor cheio
 *    (regra 6). Quem entrega o `consumed` ja resolveu isso -- este VO so
 *    calcula em cima do que recebeu.
 * 2. A notificacao dispara UMA vez por limiar, por mes. Avisar a cada
 *    transacao acima de 80% rende quinze e-mails no mesmo dia; por isso
 *    `thresholdsToNotify` recebe os limiares ja avisados e devolve so a
 *    diferenca.
 */
export class BudgetProgress {
  private constructor(
    readonly limit: Money,
    readonly consumed: Money,
    /** Sobra do mes anterior, quando o orcamento tem rollover. */
    readonly carryOver: Money,
  ) {}

  static of(limit: Money, consumed: Money, carryOver?: Money): BudgetProgress {
    return new BudgetProgress(limit, consumed, carryOver ?? Money.zero(limit.currency));
  }

  /** Limite efetivo do mes: o definido mais a sobra herdada. */
  get effectiveLimit(): Money {
    return this.limit.plus(this.carryOver);
  }

  /** Quanto ainda cabe. Negativo quando estourou. */
  get remaining(): Money {
    return this.effectiveLimit.minus(this.consumed);
  }

  /**
   * Percentual consumido, em pontos-base.
   *
   * Arredonda para BAIXO, e isso importa: com `Math.round`, gastar 79,999% do
   * orcamento viraria 80% e dispararia o alerta de "voce esta perto do limite"
   * antes de o usuario ter chegado la -- e 99,999% pintaria a barra de vermelho
   * dizendo que estourou sem ter estourado. Truncar garante que a faixa e o
   * alerta so mudam quando o limiar foi de fato cruzado.
   *
   * A conta e' inteira (`centavos * 10000 / limite`) para o truncamento nao
   * depender da representacao em ponto flutuante da divisao.
   *
   * Limite zero com consumo zero e' 0%, nao NaN; limite zero com consumo e'
   * estouro total.
   */
  get basisPoints(): number {
    const limit = this.effectiveLimit.toCents();

    if (limit <= 0) {
      return this.consumed.isPositive() ? 10_000 : 0;
    }

    return Math.floor((this.consumed.toCents() * 10_000) / limit);
  }

  /**
   * Percentual INTEIRO, truncado.
   *
   * `basisPoints / 100` devolveria 79,99 -- um numero que a tela mostraria como
   * "79,99%" e que quebra o contrato, que promete inteiro. O truncamento aqui e'
   * o mesmo dos pontos-base: 79,99% e' 79%, e nao dispara o alerta de 80%.
   */
  get percent(): number {
    return Math.floor(this.basisPoints / 100);
  }

  /**
   * A faixa e decidida em PONTOS-BASE, nao no percentual truncado.
   *
   * Com o percentual, 99,99% viraria 99 -- correto -- mas a comparacao perderia
   * a precisao que os pontos-base ja tem. Comparar na unidade mais fina mantem
   * a fronteira exatamente onde ela esta.
   */
  get band(): BudgetBand {
    const basisPoints = this.basisPoints;

    if (basisPoints >= 10_000) return 'OVER';
    if (basisPoints >= 8_000) return 'NEAR';
    return 'OK';
  }

  isExceeded(): boolean {
    return this.band === 'OVER';
  }

  /** Sobra que passa para o mes seguinte. Estouro nao vira divida herdada. */
  rolloverToNextMonth(): Money {
    const remaining = this.remaining;

    return remaining.isPositive() ? remaining : Money.zero(this.limit.currency);
  }

  /**
   * Limiares cruzados que ainda nao foram avisados.
   *
   * Sem o `alreadyNotified`, cada transacao acima de 80% dispararia um alerta
   * novo. O chamador persiste o resultado (tabela `budget_alerts`) para que a
   * proxima chamada no mesmo mes devolva lista vazia.
   */
  thresholdsToNotify(alreadyNotified: readonly number[] = []): BudgetThreshold[] {
    const notified = new Set(alreadyNotified);
    const basisPoints = this.basisPoints;

    return BUDGET_ALERT_THRESHOLDS.filter(
      (threshold) => basisPoints >= threshold * 100 && !notified.has(threshold),
    );
  }
}
