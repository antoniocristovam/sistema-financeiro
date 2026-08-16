import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '../../../config/env';
import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import {
  STORAGE_SERVICE,
  type StorageService,
} from '../../../shared/application/ports/storage-service';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/ports/unit-of-work';
import { ATTACHMENT_CLEANER } from '../../transaction/core/application/ports/attachment-cleaner';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from '../../transaction/core/domain/repositories/transaction-repository';
import { PrismaTransactionRepository } from '../../transaction/infra/prisma/prisma-transaction-repository';
import { WorkspaceAccessService } from '../../workspace/core/application/services/workspace-access';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../../workspace/core/domain/repositories/workspace-repository';
import { PrismaWorkspaceRepository } from '../../workspace/infra/prisma/repositories/prisma-workspace-repository';
import {
  ConfirmAttachmentUploadUseCase,
  DeleteAttachmentUseCase,
  GetAttachmentDownloadUrlUseCase,
  ListAttachmentsUseCase,
  RequestAttachmentUploadUseCase,
} from '../core/application/use-cases/manage-attachments';
import {
  ATTACHMENT_REPOSITORY,
  type AttachmentRepository,
} from '../core/domain/repositories/attachment-repository';
import { AttachmentsController } from './http/attachments.controller';
import { PrismaAttachmentRepository } from './prisma/prisma-attachment-repository';
import { StorageAttachmentCleaner } from './storage-attachment-cleaner';

/**
 * Comprovantes.
 *
 * Exporta o `ATTACHMENT_CLEANER`, que o modulo de lancamentos usa para cumprir
 * a regra 8 sem conhecer storage nenhum.
 */
@Module({
  controllers: [AttachmentsController],
  providers: [
    { provide: ATTACHMENT_REPOSITORY, useClass: PrismaAttachmentRepository },
    { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },
    { provide: ATTACHMENT_CLEANER, useClass: StorageAttachmentCleaner },

    {
      provide: WorkspaceAccessService,
      useFactory: (workspaces: WorkspaceRepository) => new WorkspaceAccessService(workspaces),
      inject: [WORKSPACE_REPOSITORY],
    },

    {
      provide: RequestAttachmentUploadUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        transactions: TransactionRepository,
        attachments: AttachmentRepository,
        storage: StorageService,
        config: ConfigService<Env, true>,
      ) =>
        new RequestAttachmentUploadUseCase(
          access,
          transactions,
          attachments,
          storage,
          config.get('MINIO_BUCKET_ATTACHMENTS', { infer: true }),
        ),
      inject: [
        WorkspaceAccessService,
        TRANSACTION_REPOSITORY,
        ATTACHMENT_REPOSITORY,
        STORAGE_SERVICE,
        ConfigService,
      ],
    },

    {
      provide: ConfirmAttachmentUploadUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        transactions: TransactionRepository,
        attachments: AttachmentRepository,
        storage: StorageService,
        clock: Clock,
        config: ConfigService<Env, true>,
      ) =>
        new ConfirmAttachmentUploadUseCase(
          access,
          transactions,
          attachments,
          storage,
          clock,
          config.get('MINIO_BUCKET_ATTACHMENTS', { infer: true }),
        ),
      inject: [
        WorkspaceAccessService,
        TRANSACTION_REPOSITORY,
        ATTACHMENT_REPOSITORY,
        STORAGE_SERVICE,
        CLOCK,
        ConfigService,
      ],
    },

    {
      provide: ListAttachmentsUseCase,
      useFactory: (access: WorkspaceAccessService, attachments: AttachmentRepository) =>
        new ListAttachmentsUseCase(access, attachments),
      inject: [WorkspaceAccessService, ATTACHMENT_REPOSITORY],
    },

    {
      provide: GetAttachmentDownloadUrlUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        attachments: AttachmentRepository,
        storage: StorageService,
      ) => new GetAttachmentDownloadUrlUseCase(access, attachments, storage),
      inject: [WorkspaceAccessService, ATTACHMENT_REPOSITORY, STORAGE_SERVICE],
    },

    {
      provide: DeleteAttachmentUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        attachments: AttachmentRepository,
        storage: StorageService,
        unitOfWork: UnitOfWork,
      ) => new DeleteAttachmentUseCase(access, attachments, storage, unitOfWork),
      inject: [WorkspaceAccessService, ATTACHMENT_REPOSITORY, STORAGE_SERVICE, UNIT_OF_WORK],
    },
  ],
  exports: [ATTACHMENT_CLEANER, ATTACHMENT_REPOSITORY],
})
export class AttachmentModule {}
