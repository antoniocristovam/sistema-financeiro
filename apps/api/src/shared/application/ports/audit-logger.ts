import { type AuditAction } from '@finapp/contracts';

export interface AuditEntry {
  workspaceId: string;
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Trilha das acoes sensiveis de um workspace compartilhado.
 *
 * Registrar e' responsabilidade do CASO DE USO, nao de um interceptor HTTP: o
 * interceptor so ve a requisicao, e a mesma acao pode vir de um job ou de um
 * comando de CLI, que nao passam por HTTP nenhum.
 */
export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
}

export const AUDIT_LOGGER = Symbol('AuditLogger');
