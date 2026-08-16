import { type AuthenticatedUser } from '@finapp/contracts';

import { type Workspace } from '../../../../workspace/core/domain/entities/workspace';
import { type FinancialProfile } from '../../../core/domain/entities/financial-profile';
import { type User } from '../../../core/domain/entities/user';

/**
 * Traducao da entidade para o formato do contrato.
 *
 * O presenter e' o que impede a entidade de vazar para a resposta HTTP -- sem
 * ele, adicionar `passwordHash` a `User` publicaria o hash na API sem ninguem
 * perceber. Aqui os campos sao escolhidos um a um.
 */
export class UserPresenter {
  static toHttp(
    user: User,
    profile: FinancialProfile | null,
    personalWorkspace: Workspace,
  ): AuthenticatedUser {
    return {
      id: user.id.toValue(),
      name: user.name,
      email: user.email.value,
      locale: user.locale,
      currency: user.currency,
      theme: user.theme,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      onboardingCompletedAt: profile?.onboardingCompletedAt?.toISOString() ?? null,
      personalWorkspaceId: personalWorkspace.id.toValue(),
    };
  }
}
