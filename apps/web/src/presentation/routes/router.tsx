import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';

import { useTranslation } from '../providers/locale-provider';
import { useSession } from '../providers/session-provider';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './auth/password-recovery';
import { SignInPage } from './auth/sign-in';
import { SignUpPage } from './auth/sign-up';
import { AppShell } from '../components/app-shell';
import { AccountsPage } from './accounts/accounts-page';
import { CardsPage } from './cards/cards-page';
import { CategoriesPage } from './categories/categories-page';
import { DashboardPage } from './dashboard-placeholder';
import { OnboardingPage } from './onboarding/onboarding-page';
import { RecurrencesPage } from './recurrences/recurrences-page';
import { TransactionsPage } from './transactions/transactions-page';

/** Rotas que nao exigem sessao. */
const PUBLIC_PATHS = new Set([
  '/entrar',
  '/criar-conta',
  '/esqueci-senha',
  '/redefinir-senha',
  '/verificar-email',
]);

/**
 * Guarda de navegacao.
 *
 * Tres decisoes, nesta ordem:
 *
 * 1. Enquanto a sessao esta sendo restaurada, nao decide NADA. Decidir antes
 *    mandaria para o login quem tem sessao valida -- e a tela piscaria a cada
 *    F5.
 * 2. Sem sessao em rota privada, vai para o login.
 * 3. Com sessao e onboarding incompleto, TUDO cai no wizard. E' a regra do
 *    documento: enquanto `onboardingCompletedAt` for nulo, nao ha app.
 */
function RouteGuard() {
  const { status, user } = useSession();
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const isPublic = PUBLIC_PATHS.has(pathname);

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <p className="text-sm text-content-muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return isPublic ? <Outlet /> : <Navigate to="/entrar" replace />;
  }

  // Autenticado: rota de entrada nao faz mais sentido.
  if (isPublic && pathname !== '/verificar-email') {
    return <Navigate to="/" replace />;
  }

  const onboardingPending = user !== null && user.onboardingCompletedAt === null;

  if (onboardingPending && pathname !== '/onboarding' && pathname !== '/verificar-email') {
    return <Navigate to="/onboarding" replace />;
  }

  if (!onboardingPending && pathname === '/onboarding') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

const rootRoute = createRootRoute({ component: RouteGuard });

/** `/` só decide para onde ir; nao renderiza tela propria. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function IndexRedirect() {
    const { user } = useSession();

    return (
      <Navigate to={user?.onboardingCompletedAt === null ? '/onboarding' : '/dashboard'} replace />
    );
  },
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/entrar',
  component: SignInPage,
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/criar-conta',
  component: SignUpPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/esqueci-senha',
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/redefinir-senha',
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verificar-email',
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: VerifyEmailPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingPage,
});

/** Telas internas: todas dentro da casca com sidebar. */
const withShell = (Component: () => React.JSX.Element) => () => (
  <AppShell>
    <Component />
  </AppShell>
);

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: withShell(DashboardPage),
});

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transacoes',
  component: withShell(TransactionsPage),
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contas',
  component: withShell(AccountsPage),
});

const categoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/categorias',
  component: withShell(CategoriesPage),
});

const cardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cartoes',
  component: withShell(CardsPage),
});

const recurrencesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recorrencias',
  component: withShell(RecurrencesPage),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  signUpRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  verifyEmailRoute,
  onboardingRoute,
  dashboardRoute,
  transactionsRoute,
  accountsRoute,
  categoriesRoute,
  recurrencesRoute,
  cardsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
