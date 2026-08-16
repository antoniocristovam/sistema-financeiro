import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Email } from '../../../../../shared/domain/value-objects/email';
import { type FinancialProfile } from '../entities/financial-profile';
import { type User } from '../entities/user';

/**
 * Porta do repositorio de usuarios.
 *
 * Fica em `core/domain` e nao conhece Prisma. A implementacao vive em
 * `infra/prisma/repositories` e e' amarrada no modulo.
 *
 * O usuario e' a unica entidade que NAO e' escopada por workspace -- ele e'
 * quem participa dos workspaces, nao um dado dentro deles.
 */
export interface UserRepository {
  findById(id: UniqueEntityId): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  existsByEmail(email: Email): Promise<boolean>;
  /**
   * Busca em lote, indexada por id.
   *
   * Existe para a listagem de membros nao virar N+1: uma consulta para todos os
   * usuarios do workspace, em vez de uma por membro.
   */
  findManyByIds(ids: UniqueEntityId[]): Promise<Map<string, User>>;
  save(user: User): Promise<void>;

  findProfileByUserId(userId: UniqueEntityId): Promise<FinancialProfile | null>;
  saveProfile(profile: FinancialProfile): Promise<void>;
}

export const USER_REPOSITORY = Symbol('UserRepository');
