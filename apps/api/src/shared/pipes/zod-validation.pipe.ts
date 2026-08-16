import { ApiErrorCode } from '@finapp/contracts';
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';

/**
 * Validacao de entrada com os schemas de `@finapp/contracts`.
 *
 * O MESMO schema valida no servidor e tipa o formulario no front -- e' o que
 * impede a regra de "senha precisa de maiuscula" virar duas implementacoes que
 * discordam.
 *
 * Os erros saem no formato `issues[]` do contrato, com o caminho do campo, para
 * o React Hook Form conseguir marcar a linha certa de um array.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    throw new BadRequestException(formatZodError(result.error));
  }
}

export function formatZodError(error: ZodError) {
  return {
    code: ApiErrorCode.VALIDATION_FAILED,
    message: 'Dados invalidos.',
    issues: error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  };
}
