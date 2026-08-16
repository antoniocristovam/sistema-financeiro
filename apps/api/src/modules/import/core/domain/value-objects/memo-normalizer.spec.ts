import { describe, expect, it } from 'vitest';

import { normalizeMemo, trigramSimilarity } from './memo-normalizer';

describe('normalizeMemo', () => {
  it('remove caixa, acento e pontuacao', () => {
    expect(normalizeMemo('SUPERMERCADO BOM PREÇO')).toBe('supermercado bom preco');
    expect(normalizeMemo('Padaria São João!')).toBe('padaria sao joao');
  });

  it('remove numeros de documento e parcela', () => {
    // E' o que muda entre duas exportacoes do mesmo lancamento.
    expect(normalizeMemo('SUPERMERCADO BOM PRECO *1234')).toBe('supermercado bom preco');
    expect(normalizeMemo('SUPERMERCADO BOM PRECO 12/03')).toBe('supermercado bom preco');
    expect(normalizeMemo('MERCADO 123.456/0001-90')).toBe('mercado');
  });

  it('remove palavras que so sao ruido do banco', () => {
    expect(normalizeMemo('SUPERMERCADO BOM PRECO LTDA')).toBe('supermercado bom preco');
    expect(normalizeMemo('COMPRA CARTAO DEBITO PADARIA')).toBe('padaria');
  });

  it('faz as variacoes do mesmo lancamento convergirem', () => {
    const variacoes = [
      'SUPERMERCADO BOM PRECO LTDA   *1234',
      'Supermercado Bom Preço Ltda 12/03',
      'SUPERMERCADO BOM PRECO*4321',
      '  supermercado   bom   preco  ',
    ];

    const normalizadas = new Set(variacoes.map(normalizeMemo));

    expect(normalizadas.size).toBe(1);
  });

  it('nao devolve string vazia quando so havia ruido', () => {
    // String vazia casaria com qualquer outra linha vazia.
    expect(normalizeMemo('LTDA')).toBe('ltda');
    expect(normalizeMemo('123456')).not.toBe('');
  });

  it('preserva descricoes distintas', () => {
    expect(normalizeMemo('POSTO SHELL')).not.toBe(normalizeMemo('SUPERMERCADO BOM PRECO'));
  });
});

describe('trigramSimilarity', () => {
  it('devolve milesimos inteiros, nao float', () => {
    // Assim o corte de 0,7 vira comparacao exata (>= 700).
    const score = trigramSimilarity('supermercado bom preco', 'supermercado bom preco sul');

    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1000);
  });

  it('da 1000 para strings identicas', () => {
    expect(trigramSimilarity('mercado', 'mercado')).toBe(1000);
  });

  it('da alto para variacao pequena', () => {
    expect(trigramSimilarity('supermercado bom preco', 'supermercado bom preco sul')).toBeGreaterThan(
      700,
    );
  });

  it('da baixo para descricoes diferentes', () => {
    expect(trigramSimilarity('posto shell', 'supermercado bom preco')).toBeLessThan(700);
  });

  it('trata string vazia sem quebrar', () => {
    expect(trigramSimilarity('', 'mercado')).toBe(0);
    expect(trigramSimilarity('', '')).toBe(1000);
  });

  it('e simetrico', () => {
    const a = trigramSimilarity('padaria sao joao', 'padaria sao joao centro');
    const b = trigramSimilarity('padaria sao joao centro', 'padaria sao joao');

    expect(a).toBe(b);
  });
});
