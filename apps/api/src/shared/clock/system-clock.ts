import { Injectable } from '@nestjs/common';

import { type Clock } from '../application/ports/clock';

/** Relogio real. Em teste, o lugar dele e' ocupado por um relogio parado. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
