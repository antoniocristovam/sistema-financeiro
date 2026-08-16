import { z } from 'zod';

import { zInstant, zUuid } from './primitives.js';

/**
 * Comprovantes de lancamento.
 *
 * O arquivo NAO passa pela API: o cliente pede uma URL assinada, envia direto
 * para o MinIO e depois confirma. Fazer o upload atravessar a API significaria
 * segurar um arquivo de 10 MB na memoria do processo enquanto ele sobe -- com
 * dez usuarios simultaneos isso derruba o servidor, e o Node ainda fica sem
 * event loop para responder o resto.
 */

/** Tipos aceitos. Comprovante e' foto ou PDF; o resto e' anexo indevido. */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;

export type AllowedAttachmentMimeType = (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

/** 10 MB. Foto de recibo cabe folgado; acima disso e' outra coisa. */
export const MAX_ATTACHMENT_SIZE_IN_BYTES = 10 * 1024 * 1024;

export const requestUploadUrlBodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_ATTACHMENT_MIME_TYPES, {
    errorMap: () => ({ message: 'Envie uma imagem (JPEG, PNG, WebP, HEIC) ou um PDF.' }),
  }),
  sizeInBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_ATTACHMENT_SIZE_IN_BYTES, 'O arquivo pode ter no maximo 10 MB.'),
});

export type RequestUploadUrlBody = z.infer<typeof requestUploadUrlBodySchema>;

export const uploadTicketSchema = z.object({
  /** URL assinada para o PUT direto no storage. */
  uploadUrl: z.string().url(),
  /** Chave do objeto. Volta na confirmacao. */
  objectKey: z.string(),
  expiresInSeconds: z.number().int().positive(),
});

export type UploadTicket = z.infer<typeof uploadTicketSchema>;

/**
 * Confirmacao do upload.
 *
 * Passo separado de proposito: o PUT acontece FORA da API, entao o servidor
 * precisa conferir que o objeto realmente chegou antes de criar a linha. Sem
 * isso, uma conexao caida no meio do upload deixaria um anexo no banco
 * apontando para nada -- e o preview quebraria sem explicacao.
 */
export const confirmUploadBodySchema = z.object({
  objectKey: z.string().min(1),
  /** sha256 do conteudo, calculado no cliente. Deduplica reenvio do mesmo arquivo. */
  checksum: z.string().length(64).optional(),
});

export type ConfirmUploadBody = z.infer<typeof confirmUploadBodySchema>;

export const attachmentSchema = z.object({
  id: zUuid,
  transactionId: zUuid,
  originalName: z.string(),
  mimeType: z.string(),
  sizeInBytes: z.number().int(),
  /** True para os tipos que o navegador consegue exibir inline. */
  isImage: z.boolean(),
  uploadedBy: z.object({ id: zUuid, name: z.string() }).nullable(),
  createdAt: zInstant,
});

export type Attachment = z.infer<typeof attachmentSchema>;

/**
 * Link temporario de leitura.
 *
 * TTL curto e gerado sob demanda: o bucket e' privado, e uma URL de longa
 * duracao vazada daria acesso ao comprovante de qualquer um que a recebesse.
 */
export const attachmentDownloadSchema = z.object({
  url: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
});

export type AttachmentDownload = z.infer<typeof attachmentDownloadSchema>;

export function isPreviewableImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
