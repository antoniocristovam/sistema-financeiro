import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { type AuditEntry, type AuditLogger } from '../application/ports/audit-logger';
import { PrismaTransactionManager } from '../database/prisma-transaction-manager';

/**
 * Trilha de auditoria em banco.
 *
 * Falha de auditoria NAO derruba a operacao: se o log nao gravar, a remocao do
 * membro (que ja aconteceu) nao deve voltar um erro para o usuario. O problema
 * vai para o log da aplicacao, onde o operador consegue ver.
 */
@Injectable()
export class PrismaAuditLogger implements AuditLogger {
  private readonly logger = new Logger(PrismaAuditLogger.name);

  constructor(private readonly tx: PrismaTransactionManager) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.tx.client.auditLog.create({
        data: {
          workspaceId: entry.workspaceId,
          actorUserId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Falha ao gravar auditoria (${entry.action} em ${entry.workspaceId})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
