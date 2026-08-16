/**
 * @finapp/contracts
 *
 * Fonte unica da verdade do contrato da API: os schemas Zod moram aqui, a API
 * valida com eles e o web infere os tipos deles. Nenhum tipo de
 * request/response duplicado entre as pontas -- se um campo muda, quebra a
 * compilacao dos dois lados no mesmo commit.
 *
 * Os schemas por feature entram junto com a fase da feature. O que ja esta
 * aqui: primitivas, envelope de erro, paginacao, autenticacao, workspace e a
 * regra de fechamento da divisao de despesa.
 */

export * from './enums.js';
export * from './primitives.js';
export * from './errors.js';
export * from './pagination.js';
export * from './auth.js';
export * from './workspace.js';
export * from './onboarding.js';
export * from './account.js';
export * from './category.js';
export * from './transaction.js';
export * from './attachment.js';
export * from './recurrence.js';
export * from './notification.js';
export * from './split.js';
