import { ApiErrorCode } from '@finapp/contracts';

import { DomainError } from '../../../../../shared/domain/errors/domain-error';
import { type InvalidValueError } from '../../../../../shared/domain/errors/common-errors';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { type Clock } from '../../../../../shared/application/ports/clock';
import { type MailService } from '../../../../../shared/application/ports/mail-service';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import { type Either, left, right } from '../../../../../shared/either';
import { Workspace } from '../../../../workspace/core/domain/entities/workspace';
import { WorkspaceMember } from '../../../../workspace/core/domain/entities/workspace-member';
import { Role } from '../../../../workspace/core/domain/value-objects/role';
import { type WorkspaceRepository } from '../../../../workspace/core/domain/repositories/workspace-repository';
import { FinancialProfile } from '../../domain/entities/financial-profile';
import { User } from '../../domain/entities/user';
import { UserToken } from '../../domain/entities/user-token';
import { type UserRepository } from '../../domain/repositories/user-repository';
import { type UserTokenRepository } from '../../domain/repositories/user-token-repository';
import { type Hasher } from '../ports/hasher';
import { type TokenGenerator } from '../ports/token-generator';
import { buildVerificationEmail } from '../mail/verification-email';

export class EmailAlreadyUsedError extends DomainError {
  readonly code = ApiErrorCode.EMAIL_ALREADY_USED;
  readonly message = 'Este e-mail ja esta em uso.';
  override readonly field = 'email';
}

export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
}

export interface RegisterUserOutput {
  user: User;
  personalWorkspace: Workspace;
}

type RegisterUserError = EmailAlreadyUsedError | InvalidValueError;

/**
 * Cadastro.
 *
 * Cria quatro coisas de uma vez: o usuario, o workspace PESSOAL dele, a
 * associacao como OWNER e o perfil financeiro vazio. As quatro em UMA
 * transacao -- um usuario sem workspace nao consegue fazer nada no sistema, e
 * um workspace sem dono e' orfao.
 *
 * O workspace pessoal nasce aqui, no dia zero, e nao "quando precisar": e' a
 * decisao estrutural do projeto. Todo dado financeiro pertence a um workspace.
 */
export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly userTokens: UserTokenRepository,
    private readonly hasher: Hasher,
    private readonly tokens: TokenGenerator,
    private readonly mail: MailService,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly webUrl: string,
  ) {}

  async execute(input: RegisterUserInput): Promise<Either<RegisterUserError, RegisterUserOutput>> {
    const emailResult = Email.create(input.email);

    if (emailResult.isLeft()) {
      return left(emailResult.value);
    }

    const email = emailResult.value;

    if (await this.users.existsByEmail(email)) {
      return left(new EmailAlreadyUsedError());
    }

    const now = this.clock.now();
    const passwordHash = await this.hasher.hash(input.password);

    const user = User.create({ name: input.name.trim(), email, passwordHash, createdAt: now });

    const personalWorkspace = Workspace.createPersonal('Minhas finanças', user.currency);
    const ownership = WorkspaceMember.create({
      workspaceId: personalWorkspace.id,
      userId: user.id,
      role: Role.owner(),
      joinedAt: now,
    });

    const profile = FinancialProfile.create({ userId: user.id, currency: user.currency });

    const verification = this.tokens.generate();
    const verificationToken = UserToken.create({
      userId: user.id,
      type: 'EMAIL_VERIFICATION',
      tokenHash: verification.hash,
      expiresAt: new Date(
        now.getTime() + UserToken.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
      ),
      createdAt: now,
    });

    await this.unitOfWork.run(async () => {
      await this.users.save(user);
      await this.workspaces.create(personalWorkspace, ownership);
      await this.users.saveProfile(profile);
      await this.userTokens.create(verificationToken);
    });

    // Fora da transacao: uma falha de SMTP nao pode desfazer o cadastro. O
    // usuario pode pedir outro e-mail de verificacao.
    await this.mail.send(
      buildVerificationEmail({ name: user.name, to: email.value, token: verification.plain, webUrl: this.webUrl }),
    );

    return right({ user, personalWorkspace });
  }
}
