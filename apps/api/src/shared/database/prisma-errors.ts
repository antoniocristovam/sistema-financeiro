import { Prisma } from '@prisma/client';

/**
 * Violacao de indice unico (P2002).
 *
 * Existe para os caminhos em que a colisao NAO e' erro, e sim a resposta certa:
 * materializar uma ocorrencia que ja existe, criar um aviso que ja foi enviado.
 * Deixar o banco decidir e' o que sustenta a idempotencia -- um "consulta antes
 * de inserir" seria atravessado por duas execucoes simultaneas do mesmo job.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
