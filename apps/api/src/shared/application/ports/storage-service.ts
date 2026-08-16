export interface PresignedUpload {
  url: string;
  expiresInSeconds: number;
}

export interface StoredObjectInfo {
  sizeInBytes: number;
  /** ETag do storage. Nao e' sha256 em upload multipart -- ver o caso de uso. */
  etag: string;
  mimeType: string | null;
}

/**
 * Armazenamento de objetos.
 *
 * O arquivo NUNCA passa pela API: o cliente recebe uma URL assinada e envia
 * direto para o storage. Segurar um upload de 10 MB na memoria do processo
 * Node, com varios usuarios ao mesmo tempo, consome o event loop e derruba o
 * resto da API junto.
 */
export interface StorageService {
  /** URL assinada para PUT direto. */
  presignedUpload(
    bucket: string,
    objectKey: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;

  /** URL assinada para leitura. TTL curto: o bucket e' privado. */
  presignedDownload(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
    downloadName?: string,
  ): Promise<string>;

  /**
   * Metadados do objeto. Devolve `null` se ele nao existe.
   *
   * E' o que permite CONFERIR que o upload chegou antes de criar a linha no
   * banco -- o PUT acontece fora da API, e sem essa checagem uma conexao caida
   * deixaria um anexo apontando para nada.
   */
  stat(bucket: string, objectKey: string): Promise<StoredObjectInfo | null>;

  remove(bucket: string, objectKey: string): Promise<void>;
  /** Remocao em lote, para quando a transacao inteira e' excluida. */
  removeMany(bucket: string, objectKeys: string[]): Promise<void>;
}

export const STORAGE_SERVICE = Symbol('StorageService');
