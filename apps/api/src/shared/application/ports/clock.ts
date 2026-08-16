/**
 * Relogio injetavel.
 *
 * Caso de uso NUNCA chama `new Date()` direto. Com o relogio como porta, o
 * teste de "convite expirado" nao precisa esperar sete dias nem mexer em
 * timers globais -- basta injetar um relogio parado na data que interessa.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');
