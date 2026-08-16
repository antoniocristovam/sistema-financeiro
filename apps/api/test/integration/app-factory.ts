import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';

import { AppModule } from '@/app.module';
import { MAIL_SERVICE } from '@/shared/application/ports/mail-service';

import { FakeMailService } from '../doubles/in-memory-repositories';

export interface TestApp {
  app: INestApplication;
  mail: FakeMailService;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /**
   * Liga o rate limit real.
   *
   * Desligado por padrao: o limite e' por IP, e a suite inteira sai do mesmo
   * IP -- com ele ligado, o quinto teste que cadastra alguem toma 429 e a
   * suite vira um teste de throttler disfarcado.
   *
   * Que o limite FUNCIONA e' verificado em `rate-limit.e2e-spec.ts`, que sobe
   * a aplicacao com esta opcao ligada.
   */
  throttling?: boolean;
}

/**
 * Sobe a aplicacao REAL para o teste de integracao.
 *
 * Prisma, argon2, JWT, guards e filtros sao os mesmos de producao. So o e-mail
 * vira duble -- os testes precisam LER o token enviado (link de verificacao,
 * convite), e nao ha por que depender do Mailpit para isso.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const mail = new FakeMailService();

  // `overrideGuard` nao alcanca guard registrado via APP_GUARD -- por isso o
  // desligamento passa pelo `skipIf` do proprio ThrottlerModule.
  if (options.throttling === true) {
    delete process.env.THROTTLE_DISABLED;
  } else {
    process.env.THROTTLE_DISABLED = 'true';
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_SERVICE)
    .useValue(mail)
    .compile();

  const app = moduleRef.createNestApplication();

  // Mesma configuracao do `main.ts`: sem isso o teste nao exercita o cookie.
  app.setGlobalPrefix('api');
  app.use(cookieParser());

  await app.init();

  return {
    app,
    mail,
    close: async () => {
      await app.close();
    },
  };
}

/** Extrai o token de um link do corpo do e-mail. */
export function tokenFromEmail(html: string, route: string): string {
  const match = new RegExp(`${route}\\?token=([^"&\\s]+)`).exec(html);

  if (!match?.[1]) {
    throw new Error(`Token nao encontrado no e-mail para a rota ${route}`);
  }

  return decodeURIComponent(match[1]);
}

/** Le o cookie de refresh do header `set-cookie`. */
export function refreshCookieFrom(headers: Record<string, unknown>): string | undefined {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];

  return cookies.find((cookie) => cookie.startsWith('finapp_refresh='));
}
