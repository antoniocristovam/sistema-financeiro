import { describe, expect, it } from 'vitest';

import { envSchema } from './env';

const base = {
  DATABASE_URL: 'postgresql://finapp:finapp@localhost:5432/finapp',
  JWT_SECRET: 'segredo-com-mais-de-16-chars',
  JWT_REFRESH_SECRET: 'outro-segredo-com-16-chars',
  REDIS_URL: 'redis://localhost:6379',
  MINIO_ACCESS_KEY: 'finapp',
  MINIO_SECRET_KEY: 'finapp123',
};

describe('envSchema', () => {
  describe('booleanos', () => {
    it('trata a STRING "false" como falso', () => {
      // `z.coerce.boolean()` faria `Boolean('false') === true`, e o nodemailer
      // tentaria TLS na porta plain do Mailpit -- com um erro de "wrong version
      // number" que nao aponta para a configuracao.
      const parsed = envSchema.parse({ ...base, SMTP_SECURE: 'false', MINIO_USE_SSL: 'false' });

      expect(parsed.SMTP_SECURE).toBe(false);
      expect(parsed.MINIO_USE_SSL).toBe(false);
    });

    it('aceita as formas comuns de verdadeiro', () => {
      for (const value of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
        expect(envSchema.parse({ ...base, SMTP_SECURE: value }).SMTP_SECURE, value).toBe(true);
      }
    });

    it('trata o resto como falso', () => {
      for (const value of ['false', '0', 'no', 'off', '']) {
        expect(envSchema.parse({ ...base, SMTP_SECURE: value }).SMTP_SECURE, value).toBe(false);
      }
    });

    it('usa o padrao quando ausente', () => {
      expect(envSchema.parse(base).SMTP_SECURE).toBe(false);
    });
  });

  describe('obrigatorios', () => {
    it('recusa segredo curto demais', () => {
      expect(envSchema.safeParse({ ...base, JWT_SECRET: 'curto' }).success).toBe(false);
    });

    it('recusa URL de banco invalida', () => {
      expect(envSchema.safeParse({ ...base, DATABASE_URL: 'nao-e-url' }).success).toBe(false);
    });

    it('recusa ambiente sem as chaves do MinIO', () => {
      const { MINIO_SECRET_KEY: _omitted, ...semChave } = base;

      expect(envSchema.safeParse(semChave).success).toBe(false);
    });
  });

  describe('numeros', () => {
    it('converte porta vinda como string', () => {
      expect(envSchema.parse({ ...base, API_PORT: '4000' }).API_PORT).toBe(4000);
    });

    it('recusa porta invalida', () => {
      expect(envSchema.safeParse({ ...base, API_PORT: '0' }).success).toBe(false);
      expect(envSchema.safeParse({ ...base, API_PORT: 'abc' }).success).toBe(false);
    });
  });
});
