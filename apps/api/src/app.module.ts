import { resolve } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './config/env';
import { InvoiceJobsModule } from './modules/account/infra/invoice-jobs.module';
import { AttachmentModule } from './modules/attachment/infra/attachment.module';
import { IdentityModule } from './modules/identity/infra/identity.module';
import { LedgerModule } from './modules/ledger/infra/ledger.module';
import { NotificationModule } from './modules/notification/infra/notification.module';
import { OnboardingModule } from './modules/onboarding/infra/onboarding.module';
import { RecurrenceJobsModule } from './modules/transaction/infra/recurrence-jobs.module';
import { WorkspaceModule } from './modules/workspace/infra/workspace.module';
import { DomainExceptionFilter } from './shared/filters/domain-exception.filter';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { HealthController } from './shared/http/health.controller';
import { QueueModule } from './shared/queue/queue.module';
import { SharedModule } from './shared/shared.module';

/**
 * O `.env` mora na raiz do monorepo. Resolvemos pelo caminho DESTE arquivo, e
 * nao pelo cwd -- senao a API so sobe quando o processo e' iniciado de dentro
 * de `apps/api`. Vale tanto para `src/` quanto para `dist/`: os dois estao um
 * nivel abaixo de `apps/api`.
 */
const ROOT_ENV_FILE = resolve(__dirname, '../../../.env');

/**
 * Composition root da aplicacao.
 *
 * Tres coisas sao GLOBAIS de proposito:
 *
 * - `JwtAuthGuard`: rota nova nasce protegida. Liberar exige `@Public()`
 *   explicito, entao esquecer o decorator fecha a porta em vez de abri-la.
 * - `ThrottlerGuard`: limite base para toda a API. As rotas de auth apertam
 *   ainda mais com `@Throttle`.
 * - `DomainExceptionFilter`: tudo que sai da API usa o mesmo envelope de erro
 *   do contrato, inclusive os erros que o proprio Nest levanta.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [ROOT_ENV_FILE],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      /*
       * Escape hatch dos testes de integracao.
       *
       * O limite e' por IP e a suite inteira sai do mesmo IP: com ele ligado, o
       * quinto teste que cadastra alguem toma 429 e a suite vira um teste de
       * throttler disfarcado. Que o limite FUNCIONA e' verificado em
       * `rate-limit.e2e-spec.ts`, que sobe a app sem esta variavel.
       *
       * A checagem de `NODE_ENV === 'test'` e' o que impede alguem desligar o
       * rate limit em producao por acidente de configuracao.
       */
      skipIf: () =>
        process.env.NODE_ENV === 'test' && process.env.THROTTLE_DISABLED === 'true',
    }),
    SharedModule,
    QueueModule,
    IdentityModule,
    WorkspaceModule,
    OnboardingModule,
    LedgerModule,
    AttachmentModule,
    NotificationModule,
    RecurrenceJobsModule,
    InvoiceJobsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
