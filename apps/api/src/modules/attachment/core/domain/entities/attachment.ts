import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';

export interface AttachmentProps {
  workspaceId: UniqueEntityId;
  transactionId: UniqueEntityId;
  bucket: string;
  /** Caminho do objeto no storage. Unico. */
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeInBytes: number;
  /** sha256 do conteudo. */
  checksum: string;
  uploadedByUserId: UniqueEntityId | null;
  createdAt: Date;
}

/**
 * Comprovante de um lancamento.
 *
 * A entidade guarda apenas a REFERENCIA ao objeto (bucket + chave), nunca o
 * conteudo. O binario vive no MinIO, e a unica forma de le-lo e' por URL
 * assinada de vida curta -- o bucket e' privado.
 *
 * Regra 8: excluir a transacao remove o objeto no MinIO. O cascade do banco
 * apaga a LINHA; apagar o OBJETO e' responsabilidade do caso de uso, que le as
 * chaves antes de excluir.
 */
export class Attachment extends Entity<AttachmentProps> {
  static create(
    props: Optional<AttachmentProps, 'uploadedByUserId' | 'createdAt'>,
    id?: UniqueEntityId,
  ): Attachment {
    return new Attachment(
      {
        ...props,
        uploadedByUserId: props.uploadedByUserId ?? null,
        createdAt: props.createdAt ?? new Date(),
      },
      id,
    );
  }

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get transactionId(): UniqueEntityId {
    return this.props.transactionId;
  }

  get bucket(): string {
    return this.props.bucket;
  }

  get objectKey(): string {
    return this.props.objectKey;
  }

  get originalName(): string {
    return this.props.originalName;
  }

  get mimeType(): string {
    return this.props.mimeType;
  }

  get sizeInBytes(): number {
    return this.props.sizeInBytes;
  }

  get checksum(): string {
    return this.props.checksum;
  }

  get uploadedByUserId(): UniqueEntityId | null {
    return this.props.uploadedByUserId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  /** O navegador exibe inline; PDF vira link. */
  isImage(): boolean {
    return this.props.mimeType.startsWith('image/');
  }
}
