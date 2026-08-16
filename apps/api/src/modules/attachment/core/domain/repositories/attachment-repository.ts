import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Attachment } from '../entities/attachment';

/** Anexo + quem enviou, para a listagem. */
export interface AttachmentView {
  attachment: Attachment;
  uploadedBy: { id: string; name: string } | null;
}

export interface AttachmentRepository {
  findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Attachment | null>;
  findByObjectKey(workspaceId: UniqueEntityId, objectKey: string): Promise<Attachment | null>;
  listByTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<AttachmentView[]>;
  /** Contagem por lancamento, para a listagem do extrato mostrar o clipe. */
  countByTransactions(
    workspaceId: UniqueEntityId,
    transactionIds: UniqueEntityId[],
  ): Promise<Map<string, number>>;

  create(attachment: Attachment): Promise<void>;
  delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void>;

  /**
   * Chaves dos objetos de um lancamento.
   *
   * Lidas ANTES de excluir a transacao: o cascade do banco apaga as linhas, e
   * sem as chaves em maos o objeto no MinIO ficaria orfao para sempre
   * (regra 8).
   */
  listObjectKeysByTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<{ bucket: string; objectKey: string }[]>;
}

export const ATTACHMENT_REPOSITORY = Symbol('AttachmentRepository');
