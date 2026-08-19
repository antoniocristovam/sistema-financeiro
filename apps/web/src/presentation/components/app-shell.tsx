import { type Workspace } from '@finapp/contracts';
import { Button, cn } from '@finapp/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  CreditCard,
  CalendarClock,
  LayoutDashboard,
  Menu,
  PiggyBank,
  Target,
  Receipt,
  Tags,
  Wallet,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { NotificationBell } from './notification-bell';
import { useDependencies } from '../providers/dependencies';
import { useTranslation, type TranslationKey } from '../providers/locale-provider';
import { useSession } from '../providers/session-provider';
import { useWorkspace } from '../providers/workspace-provider';

interface NavItem {
  to: string;
  label: TranslationKey;
  icon: typeof Wallet;
}

/** Itens ja implementados. O resto entra com a fase da feature. */
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/transacoes', label: 'nav.transactions', icon: Receipt },
  { to: '/contas', label: 'nav.accounts', icon: Wallet },
  { to: '/categorias', label: 'nav.categories', icon: Tags },
  { to: '/recorrencias', label: 'nav.recurrences', icon: CalendarClock },
  { to: '/cartoes', label: 'nav.cards', icon: CreditCard },
  { to: '/orcamentos', label: 'nav.budgets', icon: PiggyBank },
  { to: '/metas', label: 'nav.goals', icon: Target },
  { to: '/divisoes', label: 'nav.splits', icon: ArrowLeftRight },
];

/**
 * Casca do app: sidebar colapsavel (drawer no mobile) com o seletor de
 * workspace no topo.
 *
 * O workspace ativo vale para TUDO abaixo -- e' ele que vai no header
 * `x-workspace-id` de toda chamada escopada.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Barra do mobile */}
      <header className="flex items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('nav.openMenu')}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>

        <span className="text-sm font-semibold tracking-wide text-brand uppercase">
          {t('common.appName')}
        </span>

        <div className="ml-auto">
          <NotificationBell />
        </div>
      </header>

      <div className="flex">
        {/* Drawer do mobile */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label={t('common.cancel')}
              className="absolute inset-0 bg-overlay"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-72 bg-surface p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-semibold tracking-wide text-brand uppercase">
                  {t('common.appName')}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.cancel')}
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        <aside className="hidden w-64 shrink-0 border-r border-border-subtle bg-surface p-4 lg:block">
          <div className="mb-4 flex items-center justify-between px-2">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              {t('common.appName')}
            </p>
            <NotificationBell />
          </div>
          <SidebarContent />
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav className="flex h-full flex-col gap-1">
      <WorkspaceSwitcher />

      <div className="mt-4 space-y-0.5">
        {NAV.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;

          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-surface-sunken font-medium text-content'
                  : 'text-content-muted hover:bg-surface-raised hover:text-content',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {t(item.label)}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto pt-4">
        <Button variant="ghost" full onClick={() => void signOut()}>
          {t('auth.signOut')}
        </Button>
      </div>
    </nav>
  );
}

/**
 * Seletor de workspace.
 *
 * Trocar aqui muda o `x-workspace-id` de toda chamada seguinte e invalida o
 * cache -- os dados do workspace anterior nao podem sobreviver na tela.
 */
function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const { workspaces } = useDependencies();
  const { activeId, setActiveId } = useWorkspace();
  const [open, setOpen] = useState(false);

  const query = useQuery({ queryKey: ['workspaces'], queryFn: () => workspaces.list() });
  const list = query.data ?? [];
  const active = list.find((workspace: Workspace) => workspace.id === activeId) ?? list[0];

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border-subtle px-3 py-2 text-left transition-colors hover:bg-surface-raised"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-content">
            {active?.name ?? t('common.loading')}
          </span>
          <span className="block text-xs text-content-subtle">
            {active ? t(`workspace.roles.${active.role}` as TranslationKey) : ''}
          </span>
        </span>

        <ChevronDown className="h-4 w-4 shrink-0 text-content-subtle" aria-hidden />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-lg"
        >
          {list.map((workspace: Workspace) => (
            <li key={workspace.id}>
              <button
                type="button"
                role="option"
                aria-selected={workspace.id === active?.id}
                onClick={() => {
                  setActiveId(workspace.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-content hover:bg-surface-raised"
              >
                <span className="min-w-0 truncate">{workspace.name}</span>
                {workspace.id === active?.id && (
                  <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
