import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { type Env } from '../config/env';
import { AUDIT_LOGGER } from './application/ports/audit-logger';
import { CLOCK } from './application/ports/clock';
import { MAIL_SERVICE } from './application/ports/mail-service';
import { STORAGE_SERVICE } from './application/ports/storage-service';
import { UNIT_OF_WORK } from './application/ports/unit-of-work';
import { PrismaAuditLogger } from './audit/prisma-audit-logger';
import { SystemClock } from './clock/system-clock';
import { Argon2Hasher } from './cryptography/argon2-hasher';
import { JwtEncrypter } from './cryptography/jwt-encrypter';
import { Sha256TokenGenerator } from './cryptography/sha256-token-generator';
import { PrismaTransactionManager } from './database/prisma-transaction-manager';
import { PrismaService } from './database/prisma.service';
import { NodemailerMailService } from './mail/nodemailer-mail-service';
import { MinioStorageService } from './storage/minio-storage.service';
import { ENCRYPTER } from '../modules/identity/core/application/ports/encrypter';
import { HASHER } from '../modules/identity/core/application/ports/hasher';
import { TOKEN_GENERATOR } from '../modules/identity/core/application/ports/token-generator';

/**
 * Infraestrutura compartilhada.
 *
 * Este modulo e' o unico lugar onde as PORTAS sao amarradas as implementacoes.
 * Trocar argon2 por outra coisa, ou nodemailer por um provedor de API, e' uma
 * linha aqui -- nenhum caso de uso muda.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      global: true,
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
    ConfigModule,
  ],
  providers: [
    PrismaService,
    PrismaTransactionManager,

    { provide: CLOCK, useClass: SystemClock },
    { provide: UNIT_OF_WORK, useExisting: PrismaTransactionManager },
    { provide: HASHER, useClass: Argon2Hasher },
    { provide: ENCRYPTER, useClass: JwtEncrypter },
    { provide: TOKEN_GENERATOR, useClass: Sha256TokenGenerator },
    { provide: MAIL_SERVICE, useClass: NodemailerMailService },
    { provide: STORAGE_SERVICE, useClass: MinioStorageService },
    { provide: AUDIT_LOGGER, useClass: PrismaAuditLogger },
  ],
  exports: [
    PrismaService,
    PrismaTransactionManager,
    CLOCK,
    UNIT_OF_WORK,
    HASHER,
    ENCRYPTER,
    TOKEN_GENERATOR,
    MAIL_SERVICE,
    STORAGE_SERVICE,
    AUDIT_LOGGER,
  ],
})
export class SharedModule {}
