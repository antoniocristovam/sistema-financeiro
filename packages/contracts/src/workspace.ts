import { z } from 'zod';

import { InvitationStatus, WorkspaceRole, WorkspaceType } from './enums.js';
import { zCurrencyCode, zDisplayName, zEmail, zInstant, zUuid } from './primitives.js';

/**
 * Contrato de workspace, membros e convites.
 *
 * Workspace e' a unidade de POSSE dos dados: conta, transacao, categoria,
 * orcamento e meta pertencem a ele, nunca a um usuario. Todo endpoint escopado
 * recebe o workspace, e o caso de uso confere a associacao antes de qualquer
 * coisa.
 */

// -- Requests ----------------------------------------------------------------

export const createWorkspaceBodySchema = z.object({
  name: zDisplayName,
  baseCurrency: zCurrencyCode.default('BRL'),
});

export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;

export const updateWorkspaceBodySchema = z.object({
  name: zDisplayName.optional(),
  baseCurrency: zCurrencyCode.optional(),
});

export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceBodySchema>;

/** OWNER nao entra: posse se transfere, nao se convida. */
export const invitableRoleSchema = z.enum([
  WorkspaceRole.ADMIN,
  WorkspaceRole.MEMBER,
  WorkspaceRole.VIEWER,
]);

export const inviteMemberBodySchema = z.object({
  email: zEmail,
  role: invitableRoleSchema,
});

export type InviteMemberBody = z.infer<typeof inviteMemberBodySchema>;

export const acceptInvitationBodySchema = z.object({
  token: z.string().min(1),
});

export type AcceptInvitationBody = z.infer<typeof acceptInvitationBodySchema>;

export const changeMemberRoleBodySchema = z.object({
  role: invitableRoleSchema,
});

export type ChangeMemberRoleBody = z.infer<typeof changeMemberRoleBodySchema>;

export const transferOwnershipBodySchema = z.object({
  /** Novo dono. Precisa ja ser membro do workspace. */
  toUserId: zUuid,
});

export type TransferOwnershipBody = z.infer<typeof transferOwnershipBodySchema>;

// -- Responses ---------------------------------------------------------------

export const workspaceMemberSchema = z.object({
  id: zUuid,
  userId: zUuid,
  name: z.string(),
  email: z.string().email(),
  role: z.nativeEnum(WorkspaceRole),
  joinedAt: zInstant,
});

export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const workspaceSchema = z.object({
  id: zUuid,
  name: z.string(),
  type: z.nativeEnum(WorkspaceType),
  baseCurrency: zCurrencyCode,
  /** Papel de QUEM esta pedindo. E' o que a UI usa para esconder acao proibida. */
  role: z.nativeEnum(WorkspaceRole),
  memberCount: z.number().int().positive(),
  createdAt: zInstant,
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const invitationSchema = z.object({
  id: zUuid,
  workspaceId: zUuid,
  workspaceName: z.string(),
  email: z.string().email(),
  role: z.nativeEnum(WorkspaceRole),
  status: z.nativeEnum(InvitationStatus),
  invitedByName: z.string(),
  expiresAt: zInstant,
  createdAt: zInstant,
});

export type Invitation = z.infer<typeof invitationSchema>;

/**
 * Cabecalho enviado em toda requisicao escopada.
 *
 * O guard resolve workspace + papel a partir daqui; a decisao de "esse papel
 * pode fazer isso" fica no caso de uso, nunca no controller.
 */
export const WORKSPACE_HEADER = 'x-workspace-id';

export const workspaceParamsSchema = z.object({
  workspaceId: zUuid,
});

export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;
