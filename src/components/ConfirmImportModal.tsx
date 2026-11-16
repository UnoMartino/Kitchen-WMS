import React, { useRef, useId, useState, useEffect } from 'react';
import { useDialogModal } from '../utils/dialogLightDismiss';

export type DatabaseImportMode = 'replace' | 'merge';

export interface DatabaseBackupPayload {
  format?: string;
  version?: number;
  exported_at?: string;
  counts?: {
    inventory_items?: number;
    ean_catalog?: number;
    settings?: number;
    activity_log?: number;
  };
  data: {
    settings?: unknown[];
    inventory_items: unknown[];
    ean_catalog?: unknown[];
    activity_log?: unknown[];
  };
}

export interface DatabaseImportRequest {
  fileName: string;
  payload: DatabaseBackupPayload;
}

interface ConfirmImportModalProps {
  request: DatabaseImportRequest | null;
  onConfirm: (payload: DatabaseBackupPayload, mode: DatabaseImportMode) => Promise<void>;
  onClose: () => void;
}

export function ConfirmImportModal({ request, onConfirm, onClose }: ConfirmImportModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [cachedRequest, setCachedRequest] = useState<DatabaseImportRequest | null>(request);
  const [mode, setMode] = useState<DatabaseImportMode>('replace');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (request) {
      setCachedRequest(request);
      setMode('replace');
      setSubmitting(false);
    }
  }, [request]);

  useDialogModal(dialogRef, Boolean(request), onClose);

  const activeRequest = request ?? cachedRequest;
  const itemsCount = activeRequest?.payload.data.inventory_items.length ?? 0;
  const catalogCount = activeRequest?.payload.data.ean_catalog?.length ?? 0;
  const activityCount = activeRequest?.payload.data.activity_log?.length ?? 0;

  let formattedDate = '';
  if (activeRequest?.payload.exported_at) {
    const dt = new Date(activeRequest.payload.exported_at);
    if (!Number.isNaN(dt.getTime())) {
      formattedDate = dt.toLocaleString('pl-PL');
    }
  }

  const handleConfirm = async () => {
    if (!activeRequest || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(activeRequest.payload, mode);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog confirm-import-dialog"
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
    >
      {activeRequest && (
        <div className="dialog-sheet confirm-sheet">
          <div className="dialog-header">
            <h2 id={titleId}>Import bazy danych</h2>
            <button
              type="button"
              className="dialog-close-btn"
              onClick={onClose}
              disabled={submitting}
              aria-label="Zamknij okno importu bazy danych"
            >
              Zamknij
            </button>
          </div>

          <div className="dialog-body confirm-body">
            <div className="confirm-summary-card">
              <div className="confirm-summary-row">
                <span className="row-label">Plik kopii:</span>
                <strong>{activeRequest.fileName}</strong>
              </div>
              {formattedDate && (
                <div className="confirm-summary-row">
                  <span className="row-label">Data eksportu:</span>
                  <strong>{formattedDate}</strong>
                </div>
              )}
              <div className="confirm-summary-row">
                <span className="row-label">Produkty / EAN / Historia:</span>
                <strong>
                  {itemsCount} / {catalogCount} / {activityCount}
                </strong>
              </div>
            </div>

            <fieldset className="import-mode-fieldset">
              <legend>Wybierz sposób importu</legend>

              <label className={`import-mode-option ${mode === 'replace' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name={`${titleId}-import-mode`}
                  value="replace"
                  checked={mode === 'replace'}
                  disabled={submitting}
                  onChange={() => setMode('replace')}
                />
                <span className="import-mode-copy">
                  <strong>Zastąp całą bazę</strong>
                  <span className="field-hint">
                    Usuwa obecne zapasy, historię i ustawienia, odtwarzając stan z kopii.
                  </span>
                </span>
              </label>

              <label className={`import-mode-option ${mode === 'merge' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name={`${titleId}-import-mode`}
                  value="merge"
                  checked={mode === 'merge'}
                  disabled={submitting}
                  onChange={() => setMode('merge')}
                />
                <span className="import-mode-copy">
                  <strong>Scal z obecną bazą</strong>
                  <span className="field-hint">
                    Zachowuje aktualne dane i dopisuje brakujące pozycje oraz lokalizacje.
                  </span>
                </span>
              </label>
            </fieldset>
          </div>

          <div className="dialog-footer confirm-footer">
            <button
              type="button"
              className="btn-secondary"
              autoFocus
              disabled={submitting}
              onClick={onClose}
            >
              Anuluj
            </button>
            <button
              type="button"
              className={mode === 'replace' ? 'btn-danger' : 'btn-primary'}
              disabled={submitting}
              onClick={handleConfirm}
            >
              {submitting
                ? 'Importowanie...'
                : mode === 'replace'
                  ? 'Zastąp bazę danych'
                  : 'Scal bazę danych'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
