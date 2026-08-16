import { describe, expect, it } from 'vitest';

import { Entity } from './entity';
import { UniqueEntityId } from './unique-entity-id';

interface DummyProps {
  name: string;
}

class Dummy extends Entity<DummyProps> {
  static build(name: string, id?: UniqueEntityId): Dummy {
    return new Dummy({ name }, id);
  }

  get name(): string {
    return this.props.name;
  }
}

describe('UniqueEntityId', () => {
  it('gera um UUID quando nao recebe valor', () => {
    const id = new UniqueEntityId();

    expect(id.toValue()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('preserva o valor recebido', () => {
    const id = new UniqueEntityId('id-existente');

    expect(id.toValue()).toBe('id-existente');
    expect(id.toString()).toBe('id-existente');
  });

  it('gera ids distintos', () => {
    expect(new UniqueEntityId().toValue()).not.toBe(new UniqueEntityId().toValue());
  });

  it('compara por valor', () => {
    expect(new UniqueEntityId('a').equals(new UniqueEntityId('a'))).toBe(true);
    expect(new UniqueEntityId('a').equals(new UniqueEntityId('b'))).toBe(false);
  });
});

describe('Entity', () => {
  it('identidade e o id, nao os atributos', () => {
    // Duas transacoes com o mesmo valor, data e descricao sao lancamentos
    // DIFERENTES.
    const a = Dummy.build('igual');
    const b = Dummy.build('igual');

    expect(a.equals(b)).toBe(false);
  });

  it('mesma id e a mesma entidade, mesmo com atributos diferentes', () => {
    const id = new UniqueEntityId();

    expect(Dummy.build('antes', id).equals(Dummy.build('depois', id))).toBe(true);
  });

  it('e igual a si mesma', () => {
    const dummy = Dummy.build('x');

    expect(dummy.equals(dummy)).toBe(true);
  });

  it('nao e igual a undefined', () => {
    expect(Dummy.build('x').equals(undefined)).toBe(false);
  });

  it('gera id proprio quando nao recebe um', () => {
    expect(Dummy.build('x').id.toValue()).toBeTruthy();
  });
});
