import { Injectable } from '@nestjs/common';
import { type Attachment as PrismaAttachment } from '@prisma/client';

import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { Attachment } from '../../core/domain/entities/attachment';
import {
  type AttachmentRepository,
  type AttachmentView,
} from '../../core/domain/repositories/attachment-repository';

function toDomain(raw: PrismaAttachment): Attachment {
  return Attachment.create(
    {
      workspaceId: new UniqueEntityId(raw.workspaceId),
      transactionId: new UniqueEntityId(raw.transactionId),
      bucket: raw.bucket,
      objectKey: raw.objectKey,
      originalName: raw.originalName,
      mimeType: raw.mimeType,
      sizeInBytes: raw.sizeInBytes,
      checksum: raw.checksum,
      uploadedByUserId: raw.uploadedByUserId ? new UniqueEntityId(raw.uploadedByUserId) : null,
      createdAt: raw.createdAt,
    },
    new UniqueEntityId(raw.id),
  );
}

@Injectable()
export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Attachment | null> {
    const raw = await this.tx.client.attachment.findFirst({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
    });

    return raw ? toDomain(raw) : null;
  }

  async findByObjectKey(
    workspaceId: UniqueEntityId,
    objectKey: string,
  ): Promise<Attachment | null> {
    const raw = await this.tx.client.attachment.findFirst({
      where: { objectKey, workspaceId: workspaceId.toValue() },
    });

    return raw ? toDomain(raw) : null;
  }

  async listByTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<AttachmentView[]> {
    const rows = await this.tx.client.attachment.findMany({
      where: { workspaceId: workspaceId.toValue(), transactionId: transactionId.toValue() },
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((raw) => ({
      attachment: toDomain(raw),
      uploadedBy: raw.uploadedBy ? { id: raw.uploadedBy.id, name: raw.uploadedBy.name } : null,
    }));
  }

  async countByTransactions(
    workspaceId: UniqueEntityId,
    transactionIds: UniqueEntityId[],
  ): Promise<Map<string, number>> {
    if (transactionIds.length === 0) {
      return new Map();
    }

    const grouped = await this.tx.client.attachment.groupBy({
      by: ['transactionId'],
      where: {
        workspaceId: workspaceId.toValue(),
        transactionId: { in: transactionIds.map((id) => id.toValue()) },
      },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.transactionId, row._count._all]));
  }

  async create(attachment: Attachment): Promise<void> {
    await this.tx.client.attachment.create({
      data: {
        id: attachment.id.toValue(),
        workspaceId: attachment.workspaceId.toValue(),
        transactionId: attachment.transactionId.toValue(),
        bucket: attachment.bucket,
        objectKey: attachment.objectKey,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeInBytes: attachment.sizeInBytes,
        checksum: attachment.checksum,
        uploadedByUserId: attachment.uploadedByUserId?.toValue() ?? null,
        createdAt: attachment.createdAt,
      },
    });
  }

  async delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void> {
    await this.tx.client.attachment.deleteMany({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
    });
  }

  async listObjectKeysByTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<{ bucket: string; objectKey: string }[]> {
    return this.tx.client.attachment.findMany({
      where: { workspaceId: workspaceId.toValue(), transactionId: transactionId.toValue() },
      select: { bucket: true, objectKey: true },
    });
  }
}
