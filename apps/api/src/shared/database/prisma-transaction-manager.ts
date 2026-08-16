import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { type UnitOfWork } from '../application/ports/unit-of-work';
import { PrismaService } from './prisma.service';

/** O que os repositorios usam. Cobre tanto o client normal quanto o transacional. */
export type PrismaClientLike = Prisma.TransactionClient;

/**
 * Implementacao Prisma da `UnitOfWork`.
 *
 * O problema: `prisma.$transaction(async (tx) => ...)` entrega um client novo,
 * e todo repositorio dentro do bloco precisa usar ESSE client -- senao as
 * escritas caem fora da transacao e o "tudo ou nada" vira "algumas coisas".
 * Passar o `tx` de parametro em cada metodo poluiria toda a interface de
 * repositorio, que e' justamente o que a porta existe para evitar.
 *
 * A solucao e' `AsyncLocalStorage`: o client transacional fica no contexto
 * assincrono, e `get client()` devolve o transacional quando ha um em curso e o
 * normal quando nao ha. O repositorio nao muda de forma.
 */
@Injectable()
export class PrismaTransactionManager implements UnitOfWork {
  readonly #storage = new AsyncLocalStorage<PrismaClientLike>();

  constructor(private readonly prisma: PrismaService) {}

  /** Client que os repositorios devem usar SEMPRE. */
  get client(): PrismaClientLike {
    return this.#storage.getStore() ?? this.prisma;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    // Transacao aninhada reaproveita a de fora: abrir uma segunda faria a
    // interna commitar sozinha, quebrando a atomicidade da externa.
    if (this.#storage.getStore()) {
      return work();
    }

    return this.prisma.$transaction(async (tx) => this.#storage.run(tx, work));
  }
}
