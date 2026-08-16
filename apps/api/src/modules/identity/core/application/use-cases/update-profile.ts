import { type Locale, type Theme } from '@finapp/contracts';

import { ResourceNotFoundError } from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type User } from '../../domain/entities/user';
import { type UserRepository } from '../../domain/repositories/user-repository';

export interface UpdateProfileInput {
  userId: UniqueEntityId;
  name?: string;
  locale?: Locale;
  theme?: Theme;
  currency?: string;
}

/**
 * Preferencias do usuario: nome, idioma, tema e moeda preferida.
 *
 * A moeda aqui e' so a preferencia da PESSOA (vira a base do proximo workspace
 * pessoal). Trocar aqui nao mexe na moeda de nenhum workspace existente -- os
 * centavos ja gravados nao se convertem sozinhos.
 */
export class UpdateProfileUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(input: UpdateProfileInput): Promise<Either<ResourceNotFoundError, User>> {
    const user = await this.users.findById(input.userId);

    if (!user) {
      return left(new ResourceNotFoundError('Usuario'));
    }

    user.updateProfile({
      name: input.name?.trim(),
      locale: input.locale,
      theme: input.theme,
      currency: input.currency,
    });

    await this.users.save(user);

    return right(user);
  }
}
