import { z } from 'zod';

/**
 * Booleano vindo de variavel de ambiente.
 *
 * NAO use `z.coerce.boolean()` aqui: ele faz `Boolean(value)`, e toda string
 * nao vazia e' truthy -- entao `SMTP_SECURE=false` vira `true`. O sintoma e'
 * cruel: o nodemailer tenta TLS na porta plain do Mailpit e o e-mail some com
 * um erro de "wrong version number" que nao aponta para a configuracao.
 */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) =>
      typeof value === 'boolean'
        ? value
        : ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()),
    );

/**
 * Validacao do ambiente na subida do processo.
 *
 * Falhar aqui e' de proposito: e' melhor a API nao subir do que descobrir na
 * primeira exportacao que `MINIO_SECRET_KEY` estava vazio.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  API_URL: z.string().url().default('http://localhost:3333'),
  WEB_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().url(),

  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_DOMAIN: z.string().default('localhost'),

  REDIS_URL: z.string().url(),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: booleanFromEnv(false),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  MINIO_BUCKET_ATTACHMENTS: z.string().default('finapp-attachments'),
  MINIO_BUCKET_EXPORTS: z.string().default('finapp-exports'),
  MINIO_BUCKET_IMPORTS: z.string().default('finapp-imports'),
  EXPORT_URL_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('finapp <nao-responda@finapp.local>'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variaveis de ambiente invalidas:\n${issues}`);
  }

  return parsed.data;
}
