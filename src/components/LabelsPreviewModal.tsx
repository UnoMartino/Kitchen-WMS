import React, { useRef, useId, useState, useEffect } from 'react';
import { LabelStickerItem } from '../types';
import { useDialogModal } from '../utils/dialogLightDismiss';

interface LabelsPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: LabelStickerItem[];
  summaryText: string;
  onReprintSingle: (serial: string) => void;
  onReprintAllApi: () => void;
  onBrowserPrint: (items: LabelStickerItem[]) => void;
}

export function LabelsPreviewModal({
  isOpen,
  onClose,
  items,
  summaryText,
  onReprintSingle,
  onReprintAllApi,
  onBrowserPrint
}: LabelsPreviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [cachedItems, setCachedItems] = useState<LabelStickerItem[]>(items);

  useEffect(() => {
    if (items.length > 0) {
      setCachedItems(items);
    }
  }, [items]);

  useDialogModal(dialogRef, isOpen, onClose);

  const visibleItems = items.length > 0 ? items : cachedItems;

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
    >
      <div className="dialog-sheet">
        <div className="dialog-header">
          <h2 id={titleId}>Etykiety QR ({visibleItems.length})</h2>
          <button
            type="button"
            className="dialog-close-btn"
            onClick={onClose}
            aria-label="Zamknij podgląd etykiet"
          >
            Zamknij
          </button>
        </div>

        <div className="dialog-body">
          {summaryText && <p className="card-desc">{summaryText}</p>}
          <div className="labels-preview-grid">
            {visibleItems.map((item, idx) => (
              <div key={`${item.serial_number}-${idx}`} className="label-sticker-card">
                <div
                  className="label-sticker-qr"
                  dangerouslySetInnerHTML={{ __html: item.qr_svg || '' }}
                />
                <div className="label-sticker-serial">{item.serial_number}</div>
                <div className="label-sticker-name">{item.name}</div>
                <button
                  type="button"
                  className="chip-btn"
                  style={{ marginTop: '0.4rem' }}
                  onClick={() => onReprintSingle(item.serial_number)}
                >
                  Dodrukuj API
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="dialog-footer">
          <button type="button" className="btn-secondary" onClick={onReprintAllApi}>
            Dodrukuj wszystkie
          </button>
          <button type="button" className="btn-secondary" onClick={() => onBrowserPrint(visibleItems)}>
            Drukuj
          </button>
          <button type="button" className="btn-primary" onClick={onClose}>
            Gotowe
          </button>
        </div>
      </div>
    </dialog>
  );
}

