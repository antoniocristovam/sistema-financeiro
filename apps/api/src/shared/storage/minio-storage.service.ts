import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';

import { type Env } from '../../config/env';
import {
  type PresignedUpload,
  type StorageService,
  type StoredObjectInfo,
} from '../application/ports/storage-service';

/**
 * Storage S3-compativel (MinIO em dev).
 *
 * As URLs assinadas apontam para o ENDPOINT PUBLICO, nao para o hostname
 * interno do container: quem faz o PUT e o GET e' o navegador do usuario, e
 * `http://minio:9000` so resolve dentro da rede do Docker. Em producao os dois
 * costumam coincidir; em dev, nao -- e o sintoma seria um upload que falha por
 * DNS sem nenhuma mensagem util.
 */
@Injectable()
export class MinioStorageService implements StorageService {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly client: MinioClient;

  constructor(config: ConfigService<Env, true>) {
    this.client = new MinioClient({
      endPoint: config.get('MINIO_ENDPOINT', { infer: true }),
      port: config.get('MINIO_PORT', { infer: true }),
      useSSL: config.get('MINIO_USE_SSL', { infer: true }),
      accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
      secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
    });
  }

  async presignedUpload(
    bucket: string,
    objectKey: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    const url = await this.client.presignedPutObject(bucket, objectKey, expiresInSeconds);

    // O `Content-Type` viaja no header do PUT do cliente, nao na assinatura --
    // o MinIO grava o que o cliente mandar. Por isso o tipo tambem e' validado
    // no caso de uso e regravado a partir do que o banco conhece.
    void mimeType;

    return { url, expiresInSeconds };
  }

  async presignedDownload(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
    downloadName?: string,
  ): Promise<string> {
    // `attachment` com o nome original: sem isso o navegador baixaria o UUID.
    const headers = downloadName
      ? {
          'response-content-disposition': `inline; filename="${sanitizeFileName(downloadName)}"`,
        }
      : undefined;

    return this.client.presignedGetObject(bucket, objectKey, expiresInSeconds, headers);
  }

  async stat(bucket: string, objectKey: string): Promise<StoredObjectInfo | null> {
    try {
      const info = await this.client.statObject(bucket, objectKey);

      return {
        sizeInBytes: info.size,
        etag: info.etag,
        mimeType: (info.metaData?.['content-type'] as string | undefined) ?? null,
      };
    } catch (error) {
      // Objeto inexistente e' resposta legitima ("o upload nao chegou"), nao
      // erro de infra: quem chama precisa distinguir os dois.
      if (isNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async remove(bucket: string, objectKey: string): Promise<void> {
    try {
      await this.client.removeObject(bucket, objectKey);
    } catch (error) {
      // A linha ja saiu do banco. Falhar aqui deixaria um objeto orfao --
      // custa bytes, nao quebra tela. Loga para o operador poder limpar.
      this.logger.error(
        `Falha ao remover objeto ${bucket}/${objectKey}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async removeMany(bucket: string, objectKeys: string[]): Promise<void> {
    if (objectKeys.length === 0) {
      return;
    }

    try {
      await this.client.removeObjects(bucket, objectKeys);
    } catch (error) {
      this.logger.error(
        `Falha ao remover ${objectKeys.length} objeto(s) em ${bucket}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: string })?.code;

  return code === 'NotFound' || code === 'NoSuchKey';
}

/** Remove aspas e quebras de linha, que quebrariam o header. */
function sanitizeFileName(name: string): string {
  return name.replace(/["\r\n]/g, '').slice(0, 200);
}
