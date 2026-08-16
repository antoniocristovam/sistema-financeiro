import type { CategoryType, TaxIncomeNature } from '@prisma/client';

/**
 * Categorias semente do sistema (pt-BR).
 *
 * `workspaceId` fica nulo: sao globais, visiveis para todo mundo e nao
 * editaveis. Quem quiser mudar nome, icone ou cor ganha uma copia dentro do
 * proprio workspace (fase 6).
 *
 * Hierarquia de NO MAXIMO dois niveis. A subcategoria herda icone e cor da mae
 * quando nao define os seus -- por isso a maioria delas vem sem `icon`/`color`.
 */

export interface SeedCategory {
  /** Chave estavel. Deriva o UUID e casa a copia do usuario com a origem. */
  key: string;
  name: string;
  icon?: string;
  color?: string;
  taxNature?: TaxIncomeNature;
  children?: Array<Omit<SeedCategory, 'children'>>;
}

export interface SeedCategoryGroup {
  type: CategoryType;
  categories: SeedCategory[];
}

export const SEED_CATEGORIES: SeedCategoryGroup[] = [
  {
    type: 'EXPENSE',
    categories: [
      {
        key: 'alimentacao',
        name: 'Alimentação',
        icon: 'utensils',
        color: '#F97316',
        children: [
          { key: 'alimentacao.mercado', name: 'Mercado' },
          { key: 'alimentacao.restaurante', name: 'Restaurante' },
          { key: 'alimentacao.delivery', name: 'Delivery' },
          { key: 'alimentacao.padaria', name: 'Padaria e café' },
        ],
      },
      {
        key: 'moradia',
        name: 'Moradia',
        icon: 'house',
        color: '#6366F1',
        children: [
          { key: 'moradia.aluguel', name: 'Aluguel' },
          { key: 'moradia.condominio', name: 'Condomínio' },
          { key: 'moradia.energia', name: 'Energia elétrica' },
          { key: 'moradia.agua', name: 'Água' },
          { key: 'moradia.gas', name: 'Gás' },
          { key: 'moradia.internet', name: 'Internet e telefone' },
          { key: 'moradia.manutencao', name: 'Manutenção' },
        ],
      },
      {
        key: 'transporte',
        name: 'Transporte',
        icon: 'car',
        color: '#0EA5E9',
        children: [
          { key: 'transporte.combustivel', name: 'Combustível' },
          { key: 'transporte.publico', name: 'Transporte público' },
          { key: 'transporte.aplicativos', name: 'Aplicativos de transporte' },
          { key: 'transporte.estacionamento', name: 'Estacionamento e pedágio' },
          { key: 'transporte.manutencao', name: 'Manutenção do veículo' },
        ],
      },
      {
        key: 'saude',
        name: 'Saúde',
        icon: 'heart-pulse',
        color: '#EF4444',
        children: [
          { key: 'saude.plano', name: 'Plano de saúde' },
          { key: 'saude.consultas', name: 'Consultas' },
          { key: 'saude.exames', name: 'Exames' },
          { key: 'saude.farmacia', name: 'Farmácia' },
          { key: 'saude.academia', name: 'Academia' },
        ],
      },
      {
        key: 'educacao',
        name: 'Educação',
        icon: 'graduation-cap',
        color: '#8B5CF6',
        children: [
          { key: 'educacao.mensalidade', name: 'Mensalidade' },
          { key: 'educacao.cursos', name: 'Cursos' },
          { key: 'educacao.livros', name: 'Livros' },
          { key: 'educacao.material', name: 'Material escolar' },
        ],
      },
      {
        key: 'lazer',
        name: 'Lazer',
        icon: 'party-popper',
        color: '#EC4899',
        children: [
          { key: 'lazer.viagens', name: 'Viagens' },
          { key: 'lazer.cinema-shows', name: 'Cinema e shows' },
          { key: 'lazer.bares', name: 'Bares e baladas' },
          { key: 'lazer.hobbies', name: 'Hobbies' },
        ],
      },
      {
        key: 'assinaturas',
        name: 'Assinaturas',
        icon: 'repeat',
        color: '#14B8A6',
        children: [
          { key: 'assinaturas.streaming', name: 'Streaming' },
          { key: 'assinaturas.software', name: 'Software' },
          { key: 'assinaturas.servicos', name: 'Serviços digitais' },
        ],
      },
      {
        key: 'vestuario',
        name: 'Vestuário',
        icon: 'shirt',
        color: '#A855F7',
        children: [
          { key: 'vestuario.roupas', name: 'Roupas' },
          { key: 'vestuario.calcados', name: 'Calçados' },
          { key: 'vestuario.acessorios', name: 'Acessórios' },
        ],
      },
      {
        key: 'impostos',
        name: 'Impostos',
        icon: 'landmark',
        color: '#64748B',
        children: [
          { key: 'impostos.irpf', name: 'Imposto de renda' },
          { key: 'impostos.iptu', name: 'IPTU' },
          { key: 'impostos.ipva', name: 'IPVA' },
          { key: 'impostos.taxas', name: 'Taxas e tarifas' },
        ],
      },
    ],
  },
  {
    type: 'INCOME',
    categories: [
      {
        key: 'salario',
        name: 'Salário',
        icon: 'wallet',
        color: '#22C55E',
        taxNature: 'TRIBUTAVEL',
        children: [
          { key: 'salario.mensal', name: 'Salário mensal', taxNature: 'TRIBUTAVEL' },
          { key: 'salario.decimo-terceiro', name: '13º salário', taxNature: 'EXCLUSIVA' },
          { key: 'salario.ferias', name: 'Férias', taxNature: 'TRIBUTAVEL' },
          { key: 'salario.plr', name: 'PLR', taxNature: 'EXCLUSIVA' },
        ],
      },
      {
        key: 'freelance',
        name: 'Freelance',
        icon: 'laptop',
        color: '#10B981',
        taxNature: 'TRIBUTAVEL',
        children: [
          { key: 'freelance.projetos', name: 'Projetos', taxNature: 'TRIBUTAVEL' },
          { key: 'freelance.consultoria', name: 'Consultoria', taxNature: 'TRIBUTAVEL' },
        ],
      },
      {
        key: 'rendimentos',
        name: 'Rendimentos',
        icon: 'trending-up',
        color: '#059669',
        taxNature: 'EXCLUSIVA',
        children: [
          { key: 'rendimentos.poupanca', name: 'Poupança', taxNature: 'ISENTO' },
          { key: 'rendimentos.renda-fixa', name: 'Renda fixa', taxNature: 'EXCLUSIVA' },
          { key: 'rendimentos.dividendos', name: 'Dividendos', taxNature: 'ISENTO' },
          { key: 'rendimentos.aluguel', name: 'Aluguel recebido', taxNature: 'TRIBUTAVEL' },
        ],
      },
    ],
  },
];
