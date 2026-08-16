import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

import { type Hasher } from '../../modules/identity/core/application/ports/hasher';

/**
 * Hash de senha com argon2id.
 *
 * Parametros acima do minimo da RFC 9106 de proposito: 19 MiB de memoria e 2
 * iteracoes. O custo de memoria e' o que encarece o ataque em GPU, onde bcrypt
 * e PBKDF2 sofrem.
 *
 * `verify` nao recebe os parametros: eles vem codificados no proprio hash, o
 * que permite subir o custo no futuro sem invalidar as senhas existentes.
 */
@Injectable()
export class Argon2Hasher implements Hasher {
  private static readonly OPTIONS = {
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plain: string): Promise<string> {
    return hash(plain, Argon2Hasher.OPTIONS);
  }

  async compare(plain: string, hashed: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      // Hash corrompido ou em formato desconhecido: falha de comparacao, nao
      // excecao -- senao um registro ruim derruba a rota de login inteira.
      return false;
    }
  }
}
