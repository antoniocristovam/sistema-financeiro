import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import {
  Category,
  CategoryDepthExceededError,
  CategoryTypeMismatchError,
  SystemCategoryError,
} from './category';

const workspaceId = new UniqueEntityId();

const category = (overrides = {}): Category =>
  Category.create({ workspaceId, name: 'Alimentacao', type: 'EXPENSE', ...overrides });

const systemCategory = (overrides = {}): Category =>
  Category.create({
    workspaceId: null,
    name: 'Alimentacao',
    type: 'EXPENSE',
    systemKey: 'alimentacao',
    ...overrides,
  });

describe('Category', () => {
  describe('hierarquia de dois niveis', () => {
    it('categoria principal pode ser mae', () => {
      expect(category().canBeParent()).toBe(true);
      expect(category().isRoot()).toBe(true);
    });

    it('subcategoria NAO pode ser mae', () => {
      // Um terceiro nivel obrigaria o relatorio a escolher em que nivel
      // agregar, e a resposta seria diferente em cada tela.
      const mae = category({ name: 'Alimentacao' });
      const filha = category({ name: 'Mercado' });

      filha.moveUnder(mae);

      expect(filha.canBeParent()).toBe(false);
      expect(filha.isRoot()).toBe(false);
    });

    it('recusa criar terceiro nivel', () => {
      const mae = category({ name: 'Alimentacao' });
      const filha = category({ name: 'Mercado' });
      const neta = category({ name: 'Hortifruti' });

      filha.moveUnder(mae);
      const result = neta.moveUnder(filha);

      expect(result.isLeft() && result.value).toBeInstanceOf(CategoryDepthExceededError);
      expect(neta.parentId).toBeNull();
    });

    it('recusa subcategoria de tipo diferente da mae', () => {
      // Subcategoria de despesa dentro de categoria de receita quebraria todo
      // relatorio.
      const receita = category({ name: 'Salario', type: 'INCOME' });
      const despesa = category({ name: 'Mercado', type: 'EXPENSE' });

      const result = despesa.moveUnder(receita);

      expect(result.isLeft() && result.value).toBeInstanceOf(CategoryTypeMismatchError);
    });

    it('promove subcategoria a principal', () => {
      const mae = category({ name: 'Alimentacao' });
      const filha = category({ name: 'Mercado' });

      filha.moveUnder(mae);
      expect(filha.moveToRoot().isRight()).toBe(true);
      expect(filha.isRoot()).toBe(true);
    });
  });

  describe('heranca de aparencia', () => {
    it('subcategoria herda icone e cor da mae quando nao define os seus', () => {
      const mae = category({ icon: 'utensils', color: '#F97316' });
      const filha = category({ name: 'Mercado' });

      expect(filha.effectiveIcon(mae)).toBe('utensils');
      expect(filha.effectiveColor(mae)).toBe('#F97316');
    });

    it('os proprios valores da subcategoria vencem a heranca', () => {
      const mae = category({ icon: 'utensils', color: '#F97316' });
      const filha = category({ name: 'Mercado', icon: 'shopping-cart', color: '#22C55E' });

      expect(filha.effectiveIcon(mae)).toBe('shopping-cart');
      expect(filha.effectiveColor(mae)).toBe('#22C55E');
    });

    it('sem mae e sem valor proprio, fica nulo', () => {
      expect(category().effectiveIcon()).toBeNull();
      expect(category().effectiveColor()).toBeNull();
    });
  });

  describe('categoria do sistema', () => {
    it('e identificada pelo workspace nulo', () => {
      expect(systemCategory().isSystem()).toBe(true);
      expect(category().isSystem()).toBe(false);
    });

    it('nao pode ser renomeada nem movida', () => {
      // Quem quiser mudar ganha uma copia dentro do proprio workspace.
      const semente = systemCategory();

      expect(semente.rename('Outro nome').isLeft()).toBe(true);
      expect(semente.rename('Outro nome')).toMatchObject({ value: expect.any(SystemCategoryError) });
      expect(semente.moveToRoot().isLeft()).toBe(true);
      expect(semente.moveUnder(category()).isLeft()).toBe(true);
      expect(semente.name).toBe('Alimentacao');
    });
  });

  describe('arquivamento', () => {
    it('arquiva em vez de excluir', () => {
      const alimentacao = category();

      expect(alimentacao.isArchived()).toBe(false);
      alimentacao.archive();
      expect(alimentacao.isArchived()).toBe(true);
    });

    it('arquivar duas vezes nao move a data', () => {
      const alimentacao = category();
      alimentacao.archive(new Date('2026-01-01T00:00:00Z'));
      alimentacao.archive(new Date('2026-06-01T00:00:00Z'));

      expect(alimentacao.archivedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('desarquiva', () => {
      const alimentacao = category();
      alimentacao.archive();
      alimentacao.unarchive();

      expect(alimentacao.isArchived()).toBe(false);
    });
  });

  it('renomeia e reordena categoria do workspace', () => {
    const alimentacao = category();

    expect(alimentacao.rename('Comida').isRight()).toBe(true);
    expect(alimentacao.name).toBe('Comida');

    alimentacao.reorder(3);
    expect(alimentacao.sortOrder).toBe(3);
  });
});
