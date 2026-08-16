import {
  confirmUploadBodySchema,
  isPreviewableImage,
  requestUploadUrlBodySchema,
  type Attachment as AttachmentContract,
  type AttachmentDownload,
  type ConfirmUploadBody,
  type RequestUploadUrlBody,
  type UploadTicket,
} from '@finapp/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../../../shared/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../../../shared/decorators/current-workspace.decorator';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { DomainHttpException } from '../../../../shared/filters/domain-exception.filter';
import { ZodValidationPipe } from '../../../../shared/pipes/zod-validation.pipe';
import {
  ConfirmAttachmentUploadUseCase,
  DeleteAttachmentUseCase,
  GetAttachmentDownloadUrlUseCase,
  ListAttachmentsUseCase,
  RequestAttachmentUploadUseCase,
} from '../../core/application/use-cases/manage-attachments';
import { type AttachmentView } from '../../core/domain/repositories/attachment-repository';

function toHttp(view: AttachmentView): AttachmentContract {
  const { attachment } = view;

  return {
    id: attachment.id.toValue(),
    transactionId: attachment.transactionId.toValue(),
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeInBytes: attachment.sizeInBytes,
    isImage: isPreviewableImage(attachment.mimeType),
    uploadedBy: view.uploadedBy,
    createdAt: attachment.createdAt.toISOString(),
  };
}

/**
 * Comprovantes de um lancamento.
 *
 * O upload e' em tres tempos: pedir a URL, enviar direto ao storage, confirmar.
 * O binario nunca passa por aqui -- ver o comentario da porta `StorageService`.
 */
@Controller('transactions/:transactionId/attachments')
export class AttachmentsController {
  constructor(
    private readonly requestUpload: RequestAttachmentUploadUseCase,
    private readonly confirmUpload: ConfirmAttachmentUploadUseCase,
    private readonly listAttachments: ListAttachmentsUseCase,
    private readonly getDownloadUrl: GetAttachmentDownloadUrlUseCase,
    private readonly deleteAttachment: DeleteAttachmentUseCase,
  ) {}

  @Get()
  async list(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<AttachmentContract[]> {
    const result = await this.listAttachments.execute(
      workspaceId,
      user.id,
      new UniqueEntityId(transactionId),
    );

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value.map(toHttp);
  }

  /** Passo 1: URL assinada para o PUT direto no storage. */
  @Post('upload-url')
  async upload(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Body(new ZodValidationPipe(requestUploadUrlBodySchema)) body: RequestUploadUrlBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<UploadTicket> {
    const result = await this.requestUpload.execute({
      workspaceId,
      userId: user.id,
      transactionId: new UniqueEntityId(transactionId),
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeInBytes: body.sizeInBytes,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }

  /** Passo 3: confere que o objeto chegou e cria a linha. */
  @Post()
  async confirm(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Body(new ZodValidationPipe(confirmUploadBodySchema)) body: ConfirmUploadBody,
    @Query('fileName') fileName: string | undefined,
    @Query('mimeType') mimeType: string | undefined,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<AttachmentContract> {
    const result = await this.confirmUpload.execute({
      workspaceId,
      userId: user.id,
      transactionId: new UniqueEntityId(transactionId),
      objectKey: body.objectKey,
      fileName: fileName ?? body.objectKey.split('/').pop() ?? 'comprovante',
      mimeType: mimeType ?? 'application/octet-stream',
      ...(body.checksum ? { checksum: body.checksum } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return toHttp({ attachment: result.value, uploadedBy: { id: user.id.toValue(), name: '' } });
  }

  /** Link temporario de leitura. Gerado sob demanda, TTL curto. */
  @Get(':attachmentId/download-url')
  async download(
    @Param('transactionId', ParseUUIDPipe) _transactionId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<AttachmentDownload> {
    const result = await this.getDownloadUrl.execute({
      workspaceId,
      userId: user.id,
      attachmentId: new UniqueEntityId(attachmentId),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('transactionId', ParseUUIDPipe) _transactionId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.deleteAttachment.execute({
      workspaceId,
      userId: user.id,
      attachmentId: new UniqueEntityId(attachmentId),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }
}
