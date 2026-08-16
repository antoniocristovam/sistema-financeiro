import { type Notification } from '@finapp/contracts';
import { Button, cn } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useDependencies } from '../providers/dependencies';
import { useTranslation } from '../providers/locale-provider';

/**
 * De quanto em quanto tempo o sininho reconsulta.
 *
 * Um minuto porque a origem dos avisos e' um job DIARIO: consultar de segundo
 * em segundo gastaria bateria e banda para descobrir a mesma coisa. Se um dia
 * houver aviso em tempo real, isto vira um canal de eventos -- e o resto da
 * tela nao muda.
 */
const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const { t, tag } = useTranslation();
  const { notifications } = useDependencies();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notifications.list({ limit: 15 }),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => notifications.markRead(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Fecha ao clicar fora: o painel cobre conteudo e ficar preso aberto atrapalha.
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);

    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const unread = query.data?.unreadCount ?? 0;
  const items = query.data?.items ?? [];

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          unread > 0
            ? t('notifications.openWithCount', { count: unread })
            : t('notifications.open')
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-none font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="text-sm font-medium text-content">{t('notifications.title')}</span>

            {unread > 0 && (
              <button
                type="button"
                className="text-xs text-brand hover:underline"
                onClick={() => markRead.mutate(undefined)}
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-content-subtle">
                {t('notifications.empty')}
              </li>
            ) : (
              items.map((notification: Notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (notification.readAt === null) {
                        markRead.mutate([notification.id]);
                      }
                    }}
                    className={cn(
                      'w-full border-b border-border-subtle px-3 py-2 text-left last:border-b-0 hover:bg-surface-raised',
                      notification.readAt === null && 'bg-surface-sunken',
                    )}
                  >
                    <span className="flex items-start gap-2">
                      {notification.readAt === null && (
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-content">
                          {notification.title}
                        </span>
                        <span className="block text-xs text-content-muted">
                          {notification.body}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-content-subtle">
                          {new Intl.DateTimeFormat(tag, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }).format(new Date(notification.createdAt))}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
