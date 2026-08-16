import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'finapp:is-public';

/**
 * Libera a rota do `JwtAuthGuard`.
 *
 * O guard e' global, entao rota nova nasce protegida: esquecer este decorator
 * fecha a porta em vez de abri-la. E' o padrao seguro -- o contrario faria uma
 * rota nova vazar dados por omissao.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
