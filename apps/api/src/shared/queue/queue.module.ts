import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { type Env } from '../../config/env';

/**
 * Filas.
 *
 * A conexao sai do `REDIS_URL` e a politica de retentativa e' definida uma vez
 * aqui, nao em cada `add()`: job registrado com backoff diferente por descuido
 * e' o tipo de divergencia que so aparece em producao, no dia da falha.
 *
 * `removeOnComplete` limitado porque a fila diaria acumularia um job por dia
 * para sempre; `removeOnFail` maior de proposito -- a falha e' justamente o que
 * alguem vai querer olhar depois.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 200 },
};

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
