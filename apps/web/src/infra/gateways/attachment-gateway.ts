import {
  type Attachment,
  type AttachmentDownload,
  type RequestUploadUrlBody,
  type UploadTicket,
} from '@finapp/contracts';

import { type AttachmentGateway } from '../../application/gateways';
import { ApiRequestError, type HttpClient } from '../http/http-client';

export class HttpAttachmentGateway implements AttachmentGateway {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string, transactionId: string): Promise<Attachment[]> {
    return this.http.get<Attachment[]>(`/transactions/${transactionId}/attachments`, {
      workspaceId,
    });
  }

  /**
   * Upload em tres tempos: pedir a URL, enviar direto ao storage, confirmar.
   *
   * O PUT vai DIRETO para o MinIO, sem passar pela API -- por isso ele usa
   * `fetch` cru aqui, e nao o `HttpClient`: mandar o `Authorization` do finapp
   * para o storage faria a assinatura ser rejeitada, e o cookie de sessao nao
   * tem nada que fazer num host de arquivos.
   */
  async upload(
    workspaceId: string,
    transactionId: string,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<Attachment> {
    const body: RequestUploadUrlBody = {
      fileName: file.name,
      mimeType: file.type as RequestUploadUrlBody['mimeType'],
      sizeInBytes: file.size,
    };

    const ticket = await this.http.post<UploadTicket>(
      `/transactions/${transactionId}/attachments/upload-url`,
      body,
      { workspaceId },
    );

    await putWithProgress(ticket.uploadUrl, file, onProgress);

    const query = new URLSearchParams({ fileName: file.name, mimeType: file.type });

    return this.http.post<Attachment>(
      `/transactions/${transactionId}/attachments?${query.toString()}`,
      { objectKey: ticket.objectKey },
      { workspaceId },
    );
  }

  downloadUrl(
    workspaceId: string,
    transactionId: string,
    attachmentId: string,
  ): Promise<AttachmentDownload> {
    return this.http.get<AttachmentDownload>(
      `/transactions/${transactionId}/attachments/${attachmentId}/download-url`,
      { workspaceId },
    );
  }

  remove(workspaceId: string, transactionId: string, attachmentId: string): Promise<void> {
    return this.http.delete<void>(
      `/transactions/${transactionId}/attachments/${attachmentId}`,
      { workspaceId },
    );
  }
}

/**
 * PUT com barra de progresso.
 *
 * `XMLHttpRequest` em vez de `fetch` porque o `fetch` nao expoe progresso de
 * UPLOAD -- e uma foto de 8 MB em rede movel leva tempo suficiente para o
 * usuario achar que travou.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open('PUT', url);
    request.setRequestHeader('Content-Type', file.type);

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }

      reject(new ApiRequestError(request.status, 'UPLOAD_FAILED', 'UPLOAD_FAILED'));
    });

    request.addEventListener('error', () =>
      reject(new ApiRequestError(0, 'NETWORK', 'NETWORK')),
    );

    request.send(file);
  });
}
