import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';

/**
 * Limpeza dos comprovantes de um lancamento (regra 8).
 *
 * Porta, e nao dependencia direta do modulo de anexos: o caso de uso de
 * excluir lancamento precisa que os objetos sumam do MinIO, mas nao precisa
 * saber que existe MinIO, bucket ou chave de objeto.
 *
 * Devolve quantos objetos foram removidos -- so para o log e a auditoria.
 */
export interface AttachmentCleaner {
  purgeForTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<number>;
}

export const ATTACHMENT_CLEANER = Symbol('AttachmentCleaner');
