import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_IN_BYTES,
} from '@finapp/contracts';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type StorageService } from '../../../../../shared/application/ports/storage-service';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  ConflictError,
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type TransactionRepository } from '../../../../transaction/core/domain/repositories/transaction-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import { Attachment } from '../../domain/entities/attachment';
import {
  type AttachmentRepository,
  type AttachmentView,
} from '../../domain/repositories/attachment-repository';

type AttachmentError =
  | AccessError
  | InvalidValueError
  | ResourceNotFoundError
  | ConflictError;

/** URL de upload vale 5 min: tempo de escolher o arquivo e enviar, nao mais. */
const UPLOAD_TTL_SECONDS = 300;

/** URL de leitura vale 5 min: o suficiente para o navegador buscar a imagem. */
const DOWNLOAD_TTL_SECONDS = 300;

/** Maximo de comprovantes por lancamento. */
const MAX_PER_TRANSACTION = 10;

/**
 * Chave do objeto.
 *
 * O caminho comeca pelo `workspaceId` de proposito: alem de organizar, deixa
 * possivel aplicar politica por prefixo no bucket (retencao, replicacao) sem
 * precisar consultar o banco para saber de quem e' o arquivo.
 *
 * O nome final e' um UUID, NAO o nome enviado pelo usuario: nome de arquivo
 * vindo do cliente carrega `../`, caracteres de controle e colisao entre
 * usuarios. O nome original fica no banco, para o download devolver bonito.
 */
function buildObjectKey(
  workspaceId: UniqueEntityId,
  transactionId: UniqueEntityId,
  fileName: string,
): string {
  const extension = extname(fileName).toLowerCase().slice(0, 10).replace(/[^.a-z0-9]/g, '');

  return `${workspaceId.toValue()}/${transactionId.toValue()}/${randomUUID()}${extension}`;
}

// -- Pedido de upload ---------------------------------------------------------

export interface RequestUploadInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  transactionId: UniqueEntityId;
  fileName: string;
  mimeType: string;
  sizeInBytes: number;
}

export interface UploadTicketOutput {
  uploadUrl: string;
  objectKey: string;
  expiresInSeconds: number;
}

/**
 * Emite a URL assinada para o cliente enviar o arquivo direto ao storage.
 *
 * A validacao de tipo e tamanho acontece AQUI, antes de assinar: uma vez
 * assinada, a URL aceita qualquer conteudo que o cliente mandar. Confiar na
 * validacao do front deixaria o bucket aberto para qualquer arquivo.
 */
export class RequestAttachmentUploadUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly attachments: AttachmentRepository,
    private readonly storage: StorageService,
    private readonly bucket: string,
  ) {}

  async execute(
    input: RequestUploadInput,
  ): Promise<Either<AttachmentError, UploadTicketOutput>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    if (!(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
      return left(
        new InvalidValueError('Envie uma imagem (JPEG, PNG, WebP, HEIC) ou um PDF.', 'mimeType'),
      );
    }

    if (input.sizeInBytes <= 0 || input.sizeInBytes > MAX_ATTACHMENT_SIZE_IN_BYTES) {
      return left(new InvalidValueError('O arquivo pode ter no maximo 10 MB.', 'sizeInBytes'));
    }

    const transaction = await this.transactions.findById(input.workspaceId, input.transactionId);

    if (!transaction) {
      return left(new ResourceNotFoundError('Lancamento'));
    }

    const existing = await this.attachments.listByTransaction(
      input.workspaceId,
      input.transactionId,
    );

    if (existing.length >= MAX_PER_TRANSACTION) {
      return left(
        new ConflictError(`Um lancamento aceita no maximo ${MAX_PER_TRANSACTION} comprovantes.`),
      );
    }

    const objectKey = buildObjectKey(input.workspaceId, input.transactionId, input.fileName);

    const upload = await this.storage.presignedUpload(
      this.bucket,
      objectKey,
      input.mimeType,
      UPLOAD_TTL_SECONDS,
    );

    return right({
      uploadUrl: upload.url,
      objectKey,
      expiresInSeconds: upload.expiresInSeconds,
    });
  }
}

// -- Confirmacao --------------------------------------------------------------

export interface ConfirmUploadInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  transactionId: UniqueEntityId;
  objectKey: string;
  fileName: string;
  mimeType: string;
  checksum?: string;
}

/**
 * Confirma que o objeto chegou e cria a linha do anexo.
 *
 * Duas checagens que parecem paranoia e nao sao:
 *
 * 1. **A chave precisa pertencer a ESTE workspace e a ESTE lancamento.** Ela
 *    volta pelo cliente, entao um atacante poderia confirmar a chave de outra
 *    pessoa e ganhar um link de leitura para o comprovante alheio.
 * 2. **O objeto precisa existir de verdade.** O PUT acontece fora da API; sem
 *    conferir, uma conexao caida no meio do upload criaria um anexo apontando
 *    para nada, e o preview quebraria sem explicacao.
 *
 * O TAMANHO gravado vem do storage, nao do cliente: e' o unico numero que
 * corresponde ao que realmente subiu.
 */
export class ConfirmAttachmentUploadUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly attachments: AttachmentRepository,
    private readonly storage: StorageService,
    private readonly clock: Clock,
    private readonly bucket: string,
  ) {}

  async execute(input: ConfirmUploadInput): Promise<Either<AttachmentError, Attachment>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const expectedPrefix = `${input.workspaceId.toValue()}/${input.transactionId.toValue()}/`;

    if (!input.objectKey.startsWith(expectedPrefix) || input.objectKey.includes('..')) {
      return left(new InvalidValueError('Chave de objeto invalida.', 'objectKey'));
    }

    const transaction = await this.transactions.findById(input.workspaceId, input.transactionId);

    if (!transaction) {
      return left(new ResourceNotFoundError('Lancamento'));
    }

    const duplicate = await this.attachments.findByObjectKey(input.workspaceId, input.objectKey);

    if (duplicate) {
      return left(new ConflictError('Este comprovante ja foi anexado.'));
    }

    const stored = await this.storage.stat(this.bucket, input.objectKey);

    if (!stored) {
      return left(
        new ConflictError('O arquivo nao chegou ao servidor. Tente enviar novamente.'),
      );
    }

    if (stored.sizeInBytes > MAX_ATTACHMENT_SIZE_IN_BYTES) {
      // O tamanho declarado no pedido pode ter sido menor que o real.
      await this.storage.remove(this.bucket, input.objectKey);

      return left(new InvalidValueError('O arquivo pode ter no maximo 10 MB.', 'sizeInBytes'));
    }

    const attachment = Attachment.create({
      workspaceId: input.workspaceId,
      transactionId: input.transactionId,
      bucket: this.bucket,
      objectKey: input.objectKey,
      originalName: input.fileName.slice(0, 255),
      mimeType: input.mimeType,
      sizeInBytes: stored.sizeInBytes,
      // Sem checksum do cliente, o ETag serve de identificador do conteudo.
      checksum: (input.checksum ?? stored.etag).slice(0, 64),
      uploadedByUserId: input.userId,
      createdAt: this.clock.now(),
    });

    await this.attachments.create(attachment);

    return right(attachment);
  }
}

// -- Listagem e download ------------------------------------------------------

export class ListAttachmentsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly attachments: AttachmentRepository,
  ) {}

  async execute(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<Either<AccessError, AttachmentView[]>> {
    const authorized = await this.access.authorize(workspaceId, userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    return right(await this.attachments.listByTransaction(workspaceId, transactionId));
  }
}

export interface DownloadInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  attachmentId: UniqueEntityId;
}

/**
 * Link temporario de leitura.
 *
 * A URL e' gerada sob demanda e vale 5 minutos. Guardar um link permanente no
 * banco daria acesso ao comprovante a quem quer que recebesse a URL -- e
 * comprovante tem CPF, endereco e valor.
 */
export class GetAttachmentDownloadUrlUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly attachments: AttachmentRepository,
    private readonly storage: StorageService,
  ) {}

  async execute(
    input: DownloadInput,
  ): Promise<Either<AttachmentError, { url: string; expiresInSeconds: number }>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const attachment = await this.attachments.findById(input.workspaceId, input.attachmentId);

    if (!attachment) {
      return left(new ResourceNotFoundError('Comprovante'));
    }

    const url = await this.storage.presignedDownload(
      attachment.bucket,
      attachment.objectKey,
      DOWNLOAD_TTL_SECONDS,
      attachment.originalName,
    );

    return right({ url, expiresInSeconds: DOWNLOAD_TTL_SECONDS });
  }
}

// -- Exclusao -----------------------------------------------------------------

export interface DeleteAttachmentInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  attachmentId: UniqueEntityId;
}

/**
 * Exclusao de comprovante (regra 8).
 *
 * A ordem importa: apaga a LINHA primeiro, o OBJETO depois.
 *
 * Se fosse ao contrario e a exclusao da linha falhasse, sobraria um anexo no
 * banco apontando para um arquivo que nao existe mais -- e o usuario veria um
 * preview quebrado sem entender o motivo. Na ordem escolhida, a falha possivel
 * e' um objeto orfao no storage: custa alguns bytes e nao quebra tela nenhuma.
 */
export class DeleteAttachmentUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly attachments: AttachmentRepository,
    private readonly storage: StorageService,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: DeleteAttachmentInput): Promise<Either<AttachmentError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const attachment = await this.attachments.findById(input.workspaceId, input.attachmentId);

    if (!attachment) {
      return left(new ResourceNotFoundError('Comprovante'));
    }

    await this.unitOfWork.run(async () => {
      await this.attachments.delete(input.workspaceId, input.attachmentId);
    });

    await this.storage.remove(attachment.bucket, attachment.objectKey);

    return right(undefined);
  }
}
