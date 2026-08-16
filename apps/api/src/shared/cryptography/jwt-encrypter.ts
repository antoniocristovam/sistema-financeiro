import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import {
  type AccessTokenPayload,
  type Encrypter,
} from '../../modules/identity/core/application/ports/encrypter';
import { type Env } from '../../config/env';

/**
 * Access token JWT de vida curta.
 *
 * O payload carrega so `sub` e `email`. Papel e workspace NAO entram: eles
 * mudam (alguem e' rebaixado, removido do workspace) e um JWT nao da para
 * revogar. Se o papel viajasse no token, um membro removido continuaria com
 * acesso ate o token vencer. O papel e' resolvido a cada requisicao, no banco.
 */
@Injectable()
export class JwtEncrypter implements Encrypter {
  private readonly ttlInSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlInSeconds = parseDuration(config.get('JWT_ACCESS_TTL', { infer: true }));
  }

  async encrypt(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, { expiresIn: this.ttlInSeconds });
  }

  async decrypt(token: string): Promise<AccessTokenPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);

      return { sub: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  }

  accessTokenTtlInSeconds(): number {
    return this.ttlInSeconds;
  }
}

/** Aceita `15m`, `7d`, `3600`. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());

  if (!match) {
    throw new Error(`Duracao invalida: ${value}. Use algo como "15m", "7d" ou "3600".`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';

  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[unit] ?? 1;

  return amount * multiplier;
}
