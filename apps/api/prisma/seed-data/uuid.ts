import { createHash } from 'node:crypto';

/**
 * Namespace fixo do finapp. Nao mude: os ids das categorias semente sao
 * derivados dele, e mudar aqui recria tudo em vez de atualizar.
 */
const FINAPP_NAMESPACE = '7f3d1b28-9c4a-4f5e-8a11-2d6b0c9e4f70';

/**
 * UUID v5 (RFC 4122) determinístico a partir de um nome.
 *
 * E' o que torna o seed idempotente: rodar duas vezes atualiza as mesmas linhas
 * em vez de duplicar.
 */
export function deterministicUuid(name: string, namespace = FINAPP_NAMESPACE): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1')
    .update(Buffer.concat([namespaceBytes, Buffer.from(name, 'utf8')]))
    .digest();

  const bytes = Buffer.from(digest.subarray(0, 16));
  // versao 5
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  // variante RFC 4122
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
