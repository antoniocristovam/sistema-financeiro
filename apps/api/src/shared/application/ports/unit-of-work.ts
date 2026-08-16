/**
 * Unidade de trabalho: um bloco atomico que atravessa varios repositorios.
 *
 * Cadastrar um usuario toca `User`, `Workspace`, `WorkspaceMember` e
 * `FinancialProfile`. Sem esta abstracao, o `prisma.$transaction` vazaria para
 * dentro do caso de uso e o dominio passaria a conhecer o ORM.
 *
 * Dentro do callback, os repositorios injetados enxergam a MESMA transacao --
 * a implementacao Prisma troca o client por escopo assincrono.
 */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UnitOfWork');
