import React, { useRef, useId, useState, useEffect } from 'react';
import { useDialogModal } from '../utils/dialogLightDismiss';

export interface PrintConfirmationRequest {
  title: string;
  targetLabel: string;
  copiesLabel: string;
  printerUrl?: string;
  onConfirm: () => Promise<void> | void;
}

interface ConfirmPrintModalProps {
  request: PrintConfirmationRequest | null;
  onClose: () => void;
}

export function ConfirmPrintModal({ request, onClose }: ConfirmPrintModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [cachedRequest, setCachedRequest] = useState<PrintConfirmationRequest | null>(request);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (request) {
      setCachedRequest(request);
      setSubmitting(false);
    }
  }, [request]);

  useDialogModal(dialogRef, Boolean(request), onClose);

  const activeRequest = request ?? cachedRequest;

  const handleConfirm = async () => {
    if (!activeRequest || submitting) return;
    setSubmitting(true);
    try {
      await activeRequest.onConfirm();
    } finally {
      setSubmitting(false);
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
    >
      {activeRequest && (
        <div className="dialog-sheet confirm-sheet">
          <div className="dialog-header">
            <h2 id={titleId}>{activeRequest.title}</h2>
            <button
              type="button"
              className="dialog-close-btn"
              onClick={onClose}
              aria-label="Zamknij potwierdzenie wydruku"
            >
              Zamknij
            </button>
          </div>

          <div className="dialog-body confirm-body">
            <p className="confirm-question">
              Czy na pewno chcesz wysłać polecenie wydruku do drukarki etykiet?
            </p>
            <div className="confirm-summary-card">
              <div className="confirm-summary-row">
                <span className="row-label">Zakres / produkt:</span>
                <strong>{activeRequest.targetLabel}</strong>
              </div>
              <div className="confirm-summary-row">
                <span className="row-label">Liczba kopii:</span>
                <strong>{activeRequest.copiesLabel}</strong>
              </div>
              {activeRequest.printerUrl && (
                <div className="confirm-summary-row">
                  <span className="row-label">Drukarka API:</span>
                  <code className="confirm-url">{activeRequest.printerUrl}</code>
                </div>
              )}
            </div>
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
              className="btn-primary"
              disabled={submitting}
              onClick={handleConfirm}
            >
              {submitting ? 'Wysyłanie...' : 'Dodrukuj etykietę'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
