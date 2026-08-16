import { Inject, Injectable } from '@nestjs/common';

import {
  STORAGE_SERVICE,
  type StorageService,
} from '../../../shared/application/ports/storage-service';
import { type UniqueEntityId } from '../../../shared/domain/unique-entity-id';
import { type AttachmentCleaner } from '../../transaction/core/application/ports/attachment-cleaner';
import {
  ATTACHMENT_REPOSITORY,
  type AttachmentRepository,
} from '../core/domain/repositories/attachment-repository';

/**
 * Implementacao da regra 8: excluir lancamento remove os objetos do MinIO.
 *
 * Fica no modulo de anexos porque e' ele quem sabe onde os arquivos moram. O
 * modulo de transacoes so conhece a porta -- ele nao precisa saber que existe
 * bucket, chave ou MinIO.
 *
 * As chaves sao lidas ANTES de a transacao ser excluida: depois, o cascade do
 * banco ja levou as linhas de anexo e nao ha mais como descobrir o que apagar
 * no storage.
 */
@Injectable()
export class StorageAttachmentCleaner implements AttachmentCleaner {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepository,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async purgeForTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<number> {
    const objects = await this.attachments.listObjectKeysByTransaction(
      workspaceId,
      transactionId,
    );

    if (objects.length === 0) {
      return 0;
    }

    // Agrupa por bucket: hoje e' sempre um so, mas a remocao em lote e' por
    // bucket e assumir isso quebraria em silencio se mudasse.
    const byBucket = new Map<string, string[]>();

    for (const object of objects) {
      byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.objectKey]);
    }

    for (const [bucket, keys] of byBucket) {
      await this.storage.removeMany(bucket, keys);
    }

    return objects.length;
  }
}
