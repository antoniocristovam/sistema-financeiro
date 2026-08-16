import { describe, expect, it } from 'vitest';

import { allocate, allocateEvenly } from './allocate.js';
import { InvalidAllocationError } from './errors.js';

describe('allocate', () => {
  it('distribui o centavo de resto em vez de descartar', () => {
    // O caso do documento: R$ 100,00 entre 3 pessoas.
    expect(allocateEvenly(10_000, 3)).toEqual([3334, 3333, 3333]);
  });

  it('nunca perde nem inventa centavo, para qualquer total e qualquer numero de partes', () => {
    for (let total = 0; total <= 400; total += 1) {
      for (let parts = 1; parts <= 9; parts += 1) {
        const shares = allocateEvenly(total, parts);
        const sum = shares.reduce((acc, share) => acc + share, 0);

        expect(sum, `total=${total} parts=${parts}`).toBe(total);
        expect(shares).toHaveLength(parts);
      }
    }
  });

  it('da o resto aos PRIMEIROS participantes, de forma estavel', () => {
    // 10.000 / 7 = 1428,57... -> base 1428 (x7 = 9996), sobram 4 centavos.
    expect(allocateEvenly(10_000, 7)).toEqual([1429, 1429, 1429, 1429, 1428, 1428, 1428]);
  });

  it('respeita pesos desiguais', () => {
    expect(allocate(10_000, [50, 30, 20])).toEqual([5000, 3000, 2000]);
  });

  it('reparte o resto por maior resto, nao por ordem', () => {
    // 1000 com pesos [1, 2, 2]: bases 200 / 400 / 400 = 1000, sem sobra.
    expect(allocate(1000, [1, 2, 2])).toEqual([200, 400, 400]);

    // 1000 com pesos [1, 1, 4]: restos exatos 4 / 4 / 4 (empate triplo).
    // Bases 166/166/666 = 998; os 2 centavos vao para os menores indices.
    const tied = allocate(1000, [1, 1, 4]);
    expect(tied.reduce((acc, share) => acc + share, 0)).toBe(1000);
    expect(tied).toEqual([167, 167, 666]);

    // 100 com pesos [1, 1, 7]: restos 1 / 1 / 7 -- o peso maior leva o centavo,
    // mesmo estando por ultimo.
    const byRemainder = allocate(100, [1, 1, 7]);
    expect(byRemainder.reduce((acc, share) => acc + share, 0)).toBe(100);
    expect(byRemainder).toEqual([11, 11, 78]);
  });

  it('usa pontos-base para percentual, mantendo a conta inteira', () => {
    // 33,33% / 33,33% / 33,34% de R$ 100,00.
    expect(allocate(10_000, [3333, 3333, 3334])).toEqual([3333, 3333, 3334]);
  });

  it('preserva o sinal em estorno', () => {
    const shares = allocateEvenly(-10_000, 3);

    expect(shares).toEqual([-3334, -3333, -3333]);
    expect(shares.reduce((acc, share) => acc + share, 0)).toBe(-10_000);
  });

  it('reparte um unico centavo sem duplicar', () => {
    expect(allocateEvenly(1, 3)).toEqual([1, 0, 0]);
  });

  it('devolve zeros quando nao ha o que repartir', () => {
    expect(allocateEvenly(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it('da zero para peso zero sem quebrar o fechamento', () => {
    const shares = allocate(10_000, [1, 0, 1]);

    expect(shares[1]).toBe(0);
    expect(shares.reduce((acc, share) => acc + share, 0)).toBe(10_000);
  });

  it('e determinístico: mesma entrada, mesmo resultado', () => {
    const first = allocate(9_999_999, [3, 3, 3, 1]);
    const second = allocate(9_999_999, [3, 3, 3, 1]);

    expect(first).toEqual(second);
  });

  describe('entradas invalidas', () => {
    it('recusa total fracionario', () => {
      expect(() => allocate(100.5, [1, 1])).toThrow(InvalidAllocationError);
    });

    it('recusa lista de pesos vazia', () => {
      expect(() => allocate(100, [])).toThrow(InvalidAllocationError);
    });

    it('recusa peso negativo', () => {
      expect(() => allocate(100, [1, -1])).toThrow(InvalidAllocationError);
    });

    it('recusa soma de pesos igual a zero', () => {
      expect(() => allocate(100, [0, 0])).toThrow(InvalidAllocationError);
    });

    it('recusa numero de partes invalido', () => {
      expect(() => allocateEvenly(100, 0)).toThrow(InvalidAllocationError);
      expect(() => allocateEvenly(100, 2.5)).toThrow(InvalidAllocationError);
    });

    it('recusa peso fracionario, que tiraria a exatidao da conta', () => {
      // Percentual vai em pontos-base: 33,33% e' 3333, nao 33.33.
      expect(() => allocate(10_000, [33.33, 66.67])).toThrow(InvalidAllocationError);
    });

    it('recusa rateio que estoura o inteiro seguro', () => {
      // `total * peso` sai do intervalo exato do double e o resto deixaria de
      // ser confiavel -- melhor falhar alto do que devolver centavo errado.
      expect(() => allocate(Number.MAX_SAFE_INTEGER, [1, 4])).toThrow(InvalidAllocationError);
    });
  });
});
