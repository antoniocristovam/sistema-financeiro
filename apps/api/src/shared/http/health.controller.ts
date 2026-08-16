import { Controller, Get } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { Public } from '../decorators/public.decorator';

/**
 * Health check.
 *
 * `@Public()` e' obrigatorio aqui: o `JwtAuthGuard` e' global, e um
 * balanceador ou o healthcheck do Docker nao tem como autenticar.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; database: 'up' | 'down'; timestamp: string }> {
    let database: 'up' | 'down' = 'down';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
