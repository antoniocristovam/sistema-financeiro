import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_IN_BYTES,
  type Attachment,
} from '@finapp/contracts';
import { Alert, Button, ProgressBar, cn } from '@finapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { useDependencies } from '../providers/dependencies';
import { useTranslation } from '../providers/locale-provider';
import { useWorkspace } from '../providers/workspace-provider';
import { messageFor } from '../routes/auth/sign-in';

/**
 * Comprovantes de um lancamento.
 *
 * O arquivo vai DIRETO para o storage por URL assinada -- a API so emite o
 * ticket e confirma. O preview usa outra URL assinada, de vida curta, buscada
 * sob demanda: o bucket e' privado e o link nao pode ser guardado.
 */
export function AttachmentsPanel({ transactionId }: { transactionId: string }) {
  const { t } = useTranslation();
  const { attachments } = useDependencies();
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();

  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['attachments', activeId, transactionId],
    queryFn: () => attachments.list(activeId!, transactionId),
    enabled: activeId !== null,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['attachments', activeId, transactionId] });
    // O clipe na listagem do extrato vem da contagem: precisa recarregar junto.
    void queryClient.invalidateQueries({ queryKey: ['transactions', activeId] });
  };

  const upload = useMutation({
    mutationFn: (file: File) =>
      attachments.upload(activeId!, transactionId, file, setProgress),
    onSuccess: () => {
      setError(null);
      setProgress(null);
      invalidate();
    },
    onError: (cause) => {
      setProgress(null);
      setError(messageFor(cause, t));
    },
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) =>
      attachments.remove(activeId!, transactionId, attachmentId),
    onSuccess: invalidate,
    onError: (cause) => setError(messageFor(cause, t)),
  });

  const pick = (file: File | undefined): void => {
    if (!file) {
      return;
    }

    // Valida ANTES de pedir o ticket: uma URL assinada emitida a toa fica
    // valida por 5 minutos, e o usuario espera o upload subir para so entao
    // receber o erro.
    if (!(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError(t('attachments.invalidType'));
      return;
    }

    if (file.size > MAX_ATTACHMENT_SIZE_IN_BYTES) {
      setError(t('attachments.tooLarge'));
      return;
    }

    setError(null);
    upload.mutate(file);
  };

  const list = query.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-content">
          <Paperclip className="h-4 w-4" aria-hidden />
          {t('attachments.title')}
          {list.length > 0 && (
            <span className="text-xs text-content-subtle">({list.length})</span>
          )}
        </h3>

        <Button
          variant="ghost"
          size="sm"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-4 w-4" aria-hidden />
          {t('attachments.add')}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(',')}
        onChange={(event) => {
          pick(event.target.files?.[0]);
          // Limpa para o mesmo arquivo poder ser escolhido de novo.
          event.target.value = '';
        }}
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {progress !== null && (
        <div className="space-y-1">
          <ProgressBar percent={progress} />
          <p className="text-xs text-content-subtle">
            {t('attachments.uploading', { percent: progress })}
          </p>
        </div>
      )}

      {query.isPending ? (
        <p className="text-xs text-content-muted">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-content-subtle">{t('attachments.empty')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentCard
                attachment={attachment}
                transactionId={transactionId}
                onDelete={() => {
                  if (confirm(t('attachments.deleteConfirm'))) {
                    remove.mutate(attachment.id);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-content-subtle">{t('attachments.hint')}</p>
    </section>
  );
}

function AttachmentCard({
  attachment,
  transactionId,
  onDelete,
}: {
  attachment: Attachment;
  transactionId: string;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { attachments } = useDependencies();
  const { activeId } = useWorkspace();

  /**
   * A URL assinada e' buscada por anexo e vale 5 minutos.
   *
   * `staleTime` menor que o TTL de proposito: se a query servisse um link ja
   * vencido do cache, a imagem quebraria sem motivo aparente.
   */
  const download = useQuery({
    queryKey: ['attachment-url', activeId, attachment.id],
    queryFn: () => attachments.downloadUrl(activeId!, transactionId, attachment.id),
    enabled: activeId !== null,
    staleTime: 4 * 60 * 1000,
  });

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border-subtle">
      <a
        href={download.data?.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'flex aspect-square items-center justify-center bg-surface-sunken',
          !download.data && 'pointer-events-none',
        )}
        title={attachment.originalName}
      >
        {attachment.isImage && download.data ? (
          <img
            src={download.data.url}
            alt={attachment.originalName}
            className="h-full w-full object-cover"
          />
        ) : (
          <FileText className="h-8 w-8 text-content-subtle" aria-hidden />
        )}
      </a>

      <div className="flex items-center justify-between gap-1 border-t border-border-subtle bg-surface px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-xs text-content-muted">
          {attachment.originalName}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          aria-label={t('attachments.delete')}
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3 text-danger" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
