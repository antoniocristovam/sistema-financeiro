import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from './app-factory';

/**
 * Rate limit nas rotas de auth.
 *
 * Sobe a aplicacao com o throttler LIGADO -- e' o unico arquivo que faz isso.
 * Sem limite, o login vira um oraculo de forca bruta e o "esqueci a senha" vira
 * uma maquina de spam com o nosso dominio no remetente.
 */
describe('Rate limit (integracao)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const testApp = await createTestApp({ throttling: true });
    app = testApp.app;
    close = testApp.close;
  });

  afterAll(async () => {
    await close();
  });

  it('bloqueia rajada de tentativas de login com 429', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ana@finapp.local', password: 'Errada@123' });

    const statuses: number[] = [];

    // O limite do login e 10 por minuto.
    for (let i = 0; i < 13; i += 1) {
      statuses.push((await attempt()).status);
    }

    expect(statuses.filter((status) => status === 401).length).toBe(10);
    expect(statuses.filter((status) => status === 429).length).toBe(3);
  });

  it('o 429 sai no envelope de erro do contrato', async () => {
    // "esqueci a senha" tem o limite mais apertado: 3 por minuto.
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'ana@finapp.local' });
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'ana@finapp.local' })
      .expect(429);

    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.body.message).toBeTruthy();
  });
});
