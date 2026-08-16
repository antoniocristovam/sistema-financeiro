import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  type OpaqueToken,
  type TokenGenerator,
} from '../../modules/identity/core/application/ports/token-generator';

/**
 * Token opaco: 32 bytes aleatorios em base64url, guardado como sha256.
 *
 * SHA-256 puro (sem salt, sem custo) e' o certo aqui, ao contrario de senha: o
 * token ja tem 256 bits de entropia real, entao nao existe dicionario nem
 * forca bruta viavel, e a busca no banco precisa ser por igualdade de hash --
 * o que um hash com salt por linha tornaria impossivel sem varrer a tabela.
 */
@Injectable()
export class Sha256TokenGenerator implements TokenGenerator {
  private static readonly BYTES = 32;

  generate(): OpaqueToken {
    const plain = randomBytes(Sha256TokenGenerator.BYTES).toString('base64url');

    return { plain, hash: this.hashOf(plain) };
  }

  hashOf(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }
}
