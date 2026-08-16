import { beforeEach, describe, expect, it } from 'vitest';

import { UniqueEntityId } from '@/shared/domain/unique-entity-id';
import { Email } from '@/shared/domain/value-objects/email';
import { User } from '@/modules/identity/core/domain/entities/user';
import { WorkspaceAccessService } from '@/modules/workspace/core/application/services/workspace-access';
import { AcceptInvitationUseCase } from '@/modules/workspace/core/application/use-cases/accept-invitation';
import { CreateWorkspaceUseCase } from '@/modules/workspace/core/application/use-cases/create-workspace';
import { InviteMemberUseCase } from '@/modules/workspace/core/application/use-cases/invite-member';
import { ListWorkspacesUseCase } from '@/modules/workspace/core/application/use-cases/list-workspaces';
import {
  ChangeMemberRoleUseCase,
  DeleteWorkspaceUseCase,
  LeaveWorkspaceUseCase,
  ListInvitationsUseCase,
  ListMembersUseCase,
  RemoveMemberUseCase,
  RevokeInvitationUseCase,
  TransferOwnershipUseCase,
} from '@/modules/workspace/core/application/use-cases/manage-members';
import { Workspace } from '@/modules/workspace/core/domain/entities/workspace';
import { WorkspaceMember } from '@/modules/workspace/core/domain/entities/workspace-member';
import { Role } from '@/modules/workspace/core/domain/value-objects/role';

import {
  FakeAuditLogger,
  FakeClock,
  FakeMailService,
  FakeTokenGenerator,
  FakeUnitOfWork,
  InMemoryInvitationRepository,
  InMemoryUserRepository,
  InMemoryWorkspaceRepository,
} from '../doubles/in-memory-repositories';

const WEB_URL = 'http://localhost:5173';

const email = (value: string): Email => {
  const result = Email.create(value);
  if (result.isLeft()) throw new Error(`e-mail invalido: ${value}`);
  return result.value;
};

function setup() {
  const workspaces = new InMemoryWorkspaceRepository();
  const invitations = new InMemoryInvitationRepository();
  const users = new InMemoryUserRepository();
  const tokens = new FakeTokenGenerator();
  const mail = new FakeMailService();
  const audit = new FakeAuditLogger();
  const clock = new FakeClock();
  const unitOfWork = new FakeUnitOfWork();
  const access = new WorkspaceAccessService(workspaces);

  return {
    workspaces,
    invitations,
    users,
    tokens,
    mail,
    audit,
    clock,
    unitOfWork,
    access,
    create: new CreateWorkspaceUseCase(workspaces, clock, unitOfWork),
    list: new ListWorkspacesUseCase(workspaces),
    invite: new InviteMemberUseCase(
      access,
      workspaces,
      invitations,
      users,
      tokens,
      mail,
      audit,
      clock,
      WEB_URL,
    ),
    accept: new AcceptInvitationUseCase(
      invitations,
      workspaces,
      users,
      tokens,
      audit,
      clock,
      unitOfWork,
    ),
    revokeInvitation: new RevokeInvitationUseCase(access, invitations, audit),
    listInvitations: new ListInvitationsUseCase(access, invitations, users),
    listMembers: new ListMembersUseCase(access, workspaces, users),
    changeRole: new ChangeMemberRoleUseCase(access, workspaces, audit),
    removeMember: new RemoveMemberUseCase(access, workspaces, audit),
    leave: new LeaveWorkspaceUseCase(access, workspaces, audit),
    transfer: new TransferOwnershipUseCase(access, workspaces, audit, unitOfWork),
    remove: new DeleteWorkspaceUseCase(access, workspaces, audit, clock),
  };
}

type Context = ReturnType<typeof setup>;

function makeUser(context: Context, name: string, address: string): User {
  const user = User.create({
    name,
    email: email(address),
    passwordHash: 'irrelevante',
  });

  context.users.items.push(user);

  return user;
}

/** Workspace compartilhado com Ana como dona. */
async function sharedWorkspace(context: Context, owner: User): Promise<Workspace> {
  const result = await context.create.execute({
    userId: owner.id,
    name: 'Casa',
    baseCurrency: 'BRL',
  });

  if (result.isLeft()) throw new Error('deveria ter criado');

  return result.value;
}

function addMember(
  context: Context,
  workspace: Workspace,
  user: User,
  role: 'ADMIN' | 'MEMBER' | 'VIEWER',
): void {
  context.workspaces.members.push(
    WorkspaceMember.create({
      workspaceId: workspace.id,
      userId: user.id,
      role: Role.create(role),
    }),
  );
}

describe('CreateWorkspaceUseCase', () => {
  it('cria workspace compartilhado com o criador como dono', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');

    const workspace = await sharedWorkspace(context, ana);

    expect(workspace.isShared()).toBe(true);
    expect(context.workspaces.members[0]?.role.value).toBe('OWNER');
    // Workspace e dono nascem na mesma transacao.
    expect(context.unitOfWork.calls).toBe(1);
  });
});

describe('WorkspaceAccessService', () => {
  let context: Context;
  let ana: User;
  let bruno: User;
  let workspace: Workspace;

  beforeEach(async () => {
    context = setup();
    ana = makeUser(context, 'Ana', 'ana@finapp.local');
    bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    workspace = await sharedWorkspace(context, ana);
  });

  it('autoriza quem tem o papel necessario', async () => {
    const result = await context.access.authorize(workspace.id, ana.id, 'member:manage');

    expect(result.isRight()).toBe(true);
  });

  it('recusa quem NAO e membro com NOT_WORKSPACE_MEMBER, nao 404', async () => {
    // 404 revelaria, por eliminacao, quais ids de workspace existem.
    const result = await context.access.authorize(workspace.id, bruno.id, 'data:read');

    expect(result.isLeft() && result.value.code).toBe('NOT_WORKSPACE_MEMBER');
  });

  it('recusa membro sem o papel necessario', async () => {
    addMember(context, workspace, bruno, 'MEMBER');

    const leitura = await context.access.authorize(workspace.id, bruno.id, 'data:read');
    const gestao = await context.access.authorize(workspace.id, bruno.id, 'member:manage');

    expect(leitura.isRight()).toBe(true);
    expect(gestao.isLeft() && gestao.value.code).toBe('INSUFFICIENT_ROLE');
  });

  it('a mensagem diz qual acao foi barrada', async () => {
    addMember(context, workspace, bruno, 'VIEWER');

    const result = await context.access.authorize(workspace.id, bruno.id, 'transaction:write');

    expect(result.isLeft() && result.value.message).toContain('lancamentos');
  });
});

describe('InviteMemberUseCase', () => {
  let context: Context;
  let ana: User;
  let bruno: User;
  let workspace: Workspace;

  beforeEach(async () => {
    context = setup();
    ana = makeUser(context, 'Ana', 'ana@finapp.local');
    bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    workspace = await sharedWorkspace(context, ana);
  });

  it('cria o convite e envia o e-mail', async () => {
    const result = await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'MEMBER',
    });

    expect(result.isRight()).toBe(true);
    expect(context.invitations.items).toHaveLength(1);

    const mail = context.mail.lastTo('bruno@finapp.local');
    expect(mail?.html).toContain('/convite?token=');
    expect(mail?.subject).toContain('Casa');
  });

  it('guarda so o HASH do token', async () => {
    await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'MEMBER',
    });

    expect(context.invitations.items[0]?.tokenHash).toBe('hash:token-1');
    expect(context.invitations.items[0]?.tokenHash).not.toBe('token-1');
  });

  it('MEMBER nao pode convidar', async () => {
    addMember(context, workspace, bruno, 'MEMBER');

    const result = await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: bruno.id,
      email: 'carla@exemplo.com',
      role: 'MEMBER',
    });

    expect(result.isLeft() && result.value.code).toBe('INSUFFICIENT_ROLE');
    expect(context.invitations.items).toHaveLength(0);
  });

  it('recusa convidar quem ja e membro', async () => {
    addMember(context, workspace, bruno, 'MEMBER');

    const result = await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'ADMIN',
    });

    expect(result.isLeft() && result.value.code).toBe('ALREADY_MEMBER');
  });

  it('reenviar REVOGA o convite anterior em vez de criar um segundo', async () => {
    // Dois tokens vivos para a mesma pessoa fariam o antigo continuar
    // funcionando depois de ela usar o novo.
    await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'carla@exemplo.com',
      role: 'MEMBER',
    });

    await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'carla@exemplo.com',
      role: 'MEMBER',
    });

    const pendentes = context.invitations.items.filter((invitation) => invitation.isPending());

    expect(context.invitations.items).toHaveLength(2);
    expect(pendentes).toHaveLength(1);
    expect(context.invitations.items[0]?.status).toBe('REVOKED');
  });

  it('nao permite convidar para workspace PESSOAL', async () => {
    const pessoal = Workspace.createPersonal('Minhas financas', 'BRL');
    context.workspaces.items.push(pessoal);
    context.workspaces.members.push(
      WorkspaceMember.create({
        workspaceId: pessoal.id,
        userId: ana.id,
        role: Role.owner(),
      }),
    );

    const result = await context.invite.execute({
      workspaceId: pessoal.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'MEMBER',
    });

    expect(result.isLeft() && result.value.code).toBe('FORBIDDEN');
  });

  it('registra a auditoria', async () => {
    await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'MEMBER',
    });

    expect(context.audit.has('MEMBER_INVITED')).toBe(true);
  });
});

describe('AcceptInvitationUseCase', () => {
  let context: Context;
  let ana: User;
  let bruno: User;
  let workspace: Workspace;

  beforeEach(async () => {
    context = setup();
    ana = makeUser(context, 'Ana', 'ana@finapp.local');
    bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    workspace = await sharedWorkspace(context, ana);

    await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'MEMBER',
    });
  });

  it('adiciona o convidado com o papel do convite', async () => {
    const result = await context.accept.execute({ token: 'token-1', userId: bruno.id });

    expect(result.isRight()).toBe(true);

    const member = await context.workspaces.findMember(workspace.id, bruno.id);
    expect(member?.role.value).toBe('MEMBER');
    expect(context.invitations.items[0]?.status).toBe('ACCEPTED');
  });

  it('recusa aceite por OUTRA conta', async () => {
    // Um token vazado nao pode virar acesso para qualquer conta logada.
    const carla = makeUser(context, 'Carla', 'carla@exemplo.com');

    const result = await context.accept.execute({ token: 'token-1', userId: carla.id });

    expect(result.isLeft() && result.value.code).toBe('FORBIDDEN');
    expect(await context.workspaces.findMember(workspace.id, carla.id)).toBeNull();
  });

  it('recusa convite vencido e marca como EXPIRED', async () => {
    context.clock.advanceBy(8 * 24 * 60 * 60 * 1000);

    const result = await context.accept.execute({ token: 'token-1', userId: bruno.id });

    expect(result.isLeft()).toBe(true);
    expect(context.invitations.items[0]?.status).toBe('EXPIRED');
  });

  it('recusa aceitar duas vezes', async () => {
    await context.accept.execute({ token: 'token-1', userId: bruno.id });

    const second = await context.accept.execute({ token: 'token-1', userId: bruno.id });

    expect(second.isLeft()).toBe(true);
  });

  it('recusa convite revogado', async () => {
    const invitation = context.invitations.items[0]!;
    invitation.revoke();

    const result = await context.accept.execute({ token: 'token-1', userId: bruno.id });

    expect(result.isLeft()).toBe(true);
  });

  it('recusa token inexistente', async () => {
    const result = await context.accept.execute({ token: 'inventado', userId: bruno.id });

    expect(result.isLeft() && result.value.code).toBe('NOT_FOUND');
  });

  it('adiciona o membro e marca o convite na MESMA transacao', async () => {
    const before = context.unitOfWork.calls;

    await context.accept.execute({ token: 'token-1', userId: bruno.id });

    expect(context.unitOfWork.calls).toBe(before + 1);
  });
});

describe('ListMembersUseCase', () => {
  it('lista membros com nome e e-mail, em UMA consulta de usuarios', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana Ribeiro', 'ana@finapp.local');
    const bruno = makeUser(context, 'Bruno Alves', 'bruno@finapp.local');
    const workspace = await sharedWorkspace(context, ana);
    addMember(context, workspace, bruno, 'MEMBER');

    const result = await context.listMembers.execute(workspace.id, ana.id);

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;

    expect(result.value).toHaveLength(2);
    expect(result.value.map((entry) => entry.name)).toEqual(['Ana Ribeiro', 'Bruno Alves']);
  });

  it('VIEWER tambem ve os membros', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    const workspace = await sharedWorkspace(context, ana);
    addMember(context, workspace, bruno, 'VIEWER');

    expect((await context.listMembers.execute(workspace.id, bruno.id)).isRight()).toBe(true);
  });
});

describe('ChangeMemberRoleUseCase', () => {
  let context: Context;
  let ana: User;
  let bruno: User;
  let workspace: Workspace;

  beforeEach(async () => {
    context = setup();
    ana = makeUser(context, 'Ana', 'ana@finapp.local');
    bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    workspace = await sharedWorkspace(context, ana);
    addMember(context, workspace, bruno, 'MEMBER');
  });

  it('troca o papel de um membro', async () => {
    const result = await context.changeRole.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      targetUserId: bruno.id,
      role: 'ADMIN',
    });

    expect(result.isRight()).toBe(true);
    expect((await context.workspaces.findMember(workspace.id, bruno.id))?.role.value).toBe('ADMIN');
    expect(context.audit.has('MEMBER_ROLE_CHANGED')).toBe(true);
  });

  it('NAO promove a OWNER por aqui', async () => {
    // Posse se transfere; com dois donos, "ultimo dono" deixaria de ser uma
    // invariante checavel.
    const result = await context.changeRole.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      targetUserId: bruno.id,
      role: 'OWNER' as never,
    });

    expect(result.isLeft() && result.value.message).toContain('transferencia de posse');
  });

  it('impede rebaixar o ULTIMO dono', async () => {
    const result = await context.changeRole.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      targetUserId: ana.id,
      role: 'ADMIN',
    });

    expect(result.isLeft() && result.value.code).toBe('LAST_OWNER');
  });

  it('ADMIN nao rebaixa um OWNER', async () => {
    const carla = makeUser(context, 'Carla', 'carla@exemplo.com');
    addMember(context, workspace, carla, 'ADMIN');

    const result = await context.changeRole.execute({
      workspaceId: workspace.id,
      actorUserId: carla.id,
      targetUserId: ana.id,
      role: 'MEMBER',
    });

    expect(result.isLeft() && result.value.code).toBe('FORBIDDEN');
  });
});

describe('RemoveMemberUseCase e LeaveWorkspaceUseCase', () => {
  let context: Context;
  let ana: User;
  let bruno: User;
  let workspace: Workspace;

  beforeEach(async () => {
    context = setup();
    ana = makeUser(context, 'Ana', 'ana@finapp.local');
    bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    workspace = await sharedWorkspace(context, ana);
    addMember(context, workspace, bruno, 'MEMBER');
  });

  it('remove um membro', async () => {
    const result = await context.removeMember.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      targetUserId: bruno.id,
    });

    expect(result.isRight()).toBe(true);
    expect(await context.workspaces.findMember(workspace.id, bruno.id)).toBeNull();
    expect(context.audit.has('MEMBER_REMOVED')).toBe(true);
  });

  it('remover a si mesmo aponta para a opcao de sair', async () => {
    const result = await context.removeMember.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      targetUserId: ana.id,
    });

    expect(result.isLeft() && result.value.message).toContain('sair');
  });

  it('MEMBER pode sair', async () => {
    const result = await context.leave.execute({
      workspaceId: workspace.id,
      actorUserId: bruno.id,
    });

    expect(result.isRight()).toBe(true);
    expect(context.audit.has('MEMBER_LEFT')).toBe(true);
  });

  it('o ULTIMO dono nao pode sair', async () => {
    const result = await context.leave.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
    });

    expect(result.isLeft() && result.value.code).toBe('LAST_OWNER');
    expect(await context.workspaces.findMember(workspace.id, ana.id)).not.toBeNull();
  });

  it('nao da para sair do workspace PESSOAL', async () => {
    const pessoal = Workspace.createPersonal('Minhas financas', 'BRL');
    context.workspaces.items.push(pessoal);
    context.workspaces.members.push(
      WorkspaceMember.create({
        workspaceId: pessoal.id,
        userId: bruno.id,
        role: Role.owner(),
      }),
    );

    const result = await context.leave.execute({
      workspaceId: pessoal.id,
      actorUserId: bruno.id,
    });

    expect(result.isLeft() && result.value.code).toBe('FORBIDDEN');
  });
});

describe('TransferOwnershipUseCase', () => {
  let context: Context;
  let ana: User;
  let bruno: User;
  let workspace: Workspace;

  beforeEach(async () => {
    context = setup();
    ana = makeUser(context, 'Ana', 'ana@finapp.local');
    bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    workspace = await sharedWorkspace(context, ana);
    addMember(context, workspace, bruno, 'MEMBER');
  });

  it('promove o novo dono e rebaixa o antigo na mesma transacao', async () => {
    const before = context.unitOfWork.calls;

    const result = await context.transfer.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      toUserId: bruno.id,
    });

    expect(result.isRight()).toBe(true);
    expect((await context.workspaces.findMember(workspace.id, bruno.id))?.role.value).toBe('OWNER');
    expect((await context.workspaces.findMember(workspace.id, ana.id))?.role.value).toBe('ADMIN');
    expect(context.unitOfWork.calls).toBe(before + 1);
    expect(context.audit.has('OWNERSHIP_TRANSFERRED')).toBe(true);
  });

  it('depois da transferencia, o antigo dono consegue sair', async () => {
    await context.transfer.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      toUserId: bruno.id,
    });

    const result = await context.leave.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
    });

    expect(result.isRight()).toBe(true);
  });

  it('so o OWNER transfere', async () => {
    const carla = makeUser(context, 'Carla', 'carla@exemplo.com');
    addMember(context, workspace, carla, 'ADMIN');

    const result = await context.transfer.execute({
      workspaceId: workspace.id,
      actorUserId: carla.id,
      toUserId: bruno.id,
    });

    expect(result.isLeft() && result.value.code).toBe('INSUFFICIENT_ROLE');
  });

  it('recusa transferir para quem nao e membro', async () => {
    const forasteiro = makeUser(context, 'Forasteiro', 'fora@exemplo.com');

    const result = await context.transfer.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      toUserId: forasteiro.id,
    });

    expect(result.isLeft()).toBe(true);
    expect((await context.workspaces.findMember(workspace.id, ana.id))?.role.value).toBe('OWNER');
  });
});

describe('DeleteWorkspaceUseCase', () => {
  it('so o OWNER exclui', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    const workspace = await sharedWorkspace(context, ana);
    addMember(context, workspace, bruno, 'ADMIN');

    const porAdmin = await context.remove.execute({
      workspaceId: workspace.id,
      actorUserId: bruno.id,
    });

    expect(porAdmin.isLeft() && porAdmin.value.code).toBe('INSUFFICIENT_ROLE');

    const porDono = await context.remove.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
    });

    expect(porDono.isRight()).toBe(true);
    expect(context.workspaces.items).toHaveLength(0);
  });

  it('registra a auditoria ANTES de excluir', async () => {
    // O cascade leva o registro de auditoria junto se ele for gravado depois.
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const workspace = await sharedWorkspace(context, ana);

    await context.remove.execute({ workspaceId: workspace.id, actorUserId: ana.id });

    expect(context.audit.has('WORKSPACE_DELETED')).toBe(true);
  });
});

describe('ListWorkspacesUseCase', () => {
  it('devolve o pessoal primeiro e os compartilhados por nome', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');

    const pessoal = Workspace.createPersonal('Minhas financas', 'BRL');
    context.workspaces.items.push(pessoal);
    context.workspaces.members.push(
      WorkspaceMember.create({ workspaceId: pessoal.id, userId: ana.id, role: Role.owner() }),
    );

    await context.create.execute({ userId: ana.id, name: 'Viagem', baseCurrency: 'BRL' });
    await context.create.execute({ userId: ana.id, name: 'Casa', baseCurrency: 'BRL' });

    const result = await context.list.execute(ana.id);

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;

    expect(result.value.map((entry) => entry.workspace.name)).toEqual([
      'Minhas financas',
      'Casa',
      'Viagem',
    ]);
  });

  it('devolve o papel do usuario em cada workspace', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    const workspace = await sharedWorkspace(context, ana);
    addMember(context, workspace, bruno, 'VIEWER');

    const result = await context.list.execute(bruno.id);

    expect(result.isRight() && result.value[0]?.member.role.value).toBe('VIEWER');
    expect(result.isRight() && result.value[0]?.memberCount).toBe(2);
  });

  it('NAO devolve workspace de que o usuario nao participa', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const forasteiro = makeUser(context, 'Forasteiro', 'fora@exemplo.com');
    await sharedWorkspace(context, ana);

    const result = await context.list.execute(forasteiro.id);

    expect(result.isRight() && result.value).toHaveLength(0);
  });
});

describe('Convites: revogar e listar', () => {
  it('revoga um convite pendente', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const workspace = await sharedWorkspace(context, ana);

    const invited = await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'MEMBER',
    });

    if (invited.isLeft()) throw new Error('deveria ter convidado');

    const result = await context.revokeInvitation.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      invitationId: invited.value.invitation.id,
    });

    expect(result.isRight()).toBe(true);
    expect(context.invitations.items[0]?.status).toBe('REVOKED');
  });

  it('nao revoga convite de OUTRO workspace', async () => {
    // Convite fora do escopo simplesmente nao existe para quem pergunta daqui.
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const casa = await sharedWorkspace(context, ana);
    const viagem = await context.create.execute({
      userId: ana.id,
      name: 'Viagem',
      baseCurrency: 'BRL',
    });

    if (viagem.isLeft()) throw new Error('deveria ter criado');

    const invited = await context.invite.execute({
      workspaceId: casa.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'MEMBER',
    });

    if (invited.isLeft()) throw new Error('deveria ter convidado');

    const result = await context.revokeInvitation.execute({
      workspaceId: viagem.value.id,
      actorUserId: ana.id,
      invitationId: invited.value.invitation.id,
    });

    expect(result.isLeft()).toBe(true);
    expect(context.invitations.items[0]?.status).toBe('PENDING');
  });

  it('lista convites com o nome de quem convidou', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana Ribeiro', 'ana@finapp.local');
    const workspace = await sharedWorkspace(context, ana);

    await context.invite.execute({
      workspaceId: workspace.id,
      actorUserId: ana.id,
      email: 'bruno@finapp.local',
      role: 'MEMBER',
    });

    const result = await context.listInvitations.execute(workspace.id, ana.id);

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;

    expect(result.value[0]?.invitedByName).toBe('Ana Ribeiro');
    expect(result.value[0]?.workspaceName).toBe('Casa');
  });

  it('MEMBER nao lista convites', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');
    const workspace = await sharedWorkspace(context, ana);
    addMember(context, workspace, bruno, 'MEMBER');

    const result = await context.listInvitations.execute(workspace.id, bruno.id);

    expect(result.isLeft() && result.value.code).toBe('INSUFFICIENT_ROLE');
  });
});

describe('Isolamento entre workspaces (IDOR)', () => {
  it('membro de um workspace nao acessa outro', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');
    const bruno = makeUser(context, 'Bruno', 'bruno@finapp.local');

    const casa = await sharedWorkspace(context, ana);
    const viagem = await context.create.execute({
      userId: bruno.id,
      name: 'Viagem do Bruno',
      baseCurrency: 'BRL',
    });

    if (viagem.isLeft()) throw new Error('deveria ter criado');

    // Bruno e dono do dele, e nao tem NADA no da Ana.
    const naCasaDaAna = await context.listMembers.execute(casa.id, bruno.id);
    const noProprio = await context.listMembers.execute(viagem.value.id, bruno.id);

    expect(naCasaDaAna.isLeft() && naCasaDaAna.value.code).toBe('NOT_WORKSPACE_MEMBER');
    expect(noProprio.isRight()).toBe(true);
  });

  it('id de workspace inexistente nao vaza que nao existe', async () => {
    const context = setup();
    const ana = makeUser(context, 'Ana', 'ana@finapp.local');

    const result = await context.listMembers.execute(new UniqueEntityId(), ana.id);

    expect(result.isLeft() && result.value.code).toBe('NOT_WORKSPACE_MEMBER');
  });
});
