import React, { useRef, useId, useState, useEffect, useMemo } from 'react';
import { InventoryItem } from '../types';
import { useDialogModal } from '../utils/dialogLightDismiss';

export type ConsumeMode = 'unit' | 'percent';

interface ConsumeCustomModalProps {
  item: InventoryItem | null;
  onConfirm: (id: number, opts: { delta?: number; fraction?: number }) => Promise<void>;
  onClose: () => void;
}

const PERCENT_PRESETS = [5, 10, 15, 20, 25, 33, 50, 75];

function getUnitPresets(item: InventoryItem): number[] {
  const unit = (item.unit || '').toLowerCase().trim();
  const maxRef = Math.max(item.quantity || 0, item.initial_quantity || 0);

  let candidates: number[];
  if (unit === 'g' || unit === 'ml') {
    candidates = [5, 10, 25, 50, 100, 150, 200, 250, 500];
  } else if (unit === 'kg' || unit === 'l') {
    candidates = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 1.5, 2];
  } else {
    candidates = [0.25, 0.5, 1, 2, 3, 4, 5, 10];
  }

  const reasonable = candidates.filter((v) => maxRef <= 0 || v <= maxRef);
  if (reasonable.length >= 4) {
    return reasonable.slice(0, 8);
  }
  return candidates.slice(0, 6);
}

export function ConsumeCustomModal({ item, onConfirm, onClose }: ConsumeCustomModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [cachedItem, setCachedItem] = useState<InventoryItem | null>(item);
  const [mode, setMode] = useState<ConsumeMode>('unit');
  const [amountInput, setAmountInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (item) {
      setCachedItem(item);
      setMode('unit');
      setAmountInput('');
      setSubmitting(false);
    }
  }, [item]);

  useDialogModal(dialogRef, Boolean(item), onClose);

  const activeItem = item ?? cachedItem;

  const unitPresets = useMemo(
    () => (activeItem ? getUnitPresets(activeItem) : []),
    [activeItem]
  );

  const parsedValue = parseFloat(amountInput.replace(',', '.'));
  const hasValidInput =
    Number.isFinite(parsedValue) &&
    parsedValue > 0 &&
    (mode === 'unit' || parsedValue <= 100);

  const currentQty = activeItem ? Number(activeItem.quantity) || 0 : 0;
  const baseInitial = activeItem
    ? Math.max(Number(activeItem.initial_quantity) || 0, currentQty || 1)
    : 1;

  const deltaQty = hasValidInput
    ? mode === 'unit'
      ? Math.round(parsedValue * 100) / 100
      : Math.round(baseInitial * (parsedValue / 100) * 100) / 100
    : 0;

  const remainingQty = Math.max(0, Math.round((currentQty - deltaQty) * 100) / 100);
  const remainingPct =
    baseInitial > 0 ? Math.max(0, Math.min(100, Math.round((remainingQty / baseInitial) * 100))) : 0;
  const willDelete = hasValidInput && remainingQty <= 0;

  const handleModeSwitch = (nextMode: ConsumeMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setAmountInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || !hasValidInput || submitting) return;
    setSubmitting(true);
    try {
      const opts =
        mode === 'unit'
          ? { delta: Math.round(parsedValue * 100) / 100 }
          : { fraction: parsedValue / 100 };
      await onConfirm(activeItem.id, opts);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog consume-custom-dialog"
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
    >
      {activeItem && (
        <div className="dialog-sheet confirm-sheet">
          <div className="dialog-header">
            <h2 id={titleId}>Zużyj częściowo — {activeItem.name}</h2>
            <button
              type="button"
              className="dialog-close-btn"
              onClick={onClose}
              disabled={submitting}
              aria-label="Zamknij okno częściowego zużycia"
            >
              Zamknij
            </button>
          </div>

          <form onSubmit={handleSubmit} className="consume-custom-form">
            <div className="dialog-body confirm-body">
              <div className="confirm-summary-card">
                <div className="confirm-summary-row">
                  <span className="row-label">Obecnie w opakowaniu:</span>
                  <strong>
                    {activeItem.quantity} / {activeItem.initial_quantity} {activeItem.unit} (
                    {activeItem.percent_remaining}%)
                  </strong>
                </div>
                {hasValidInput && (
                  <>
                    <div className="confirm-summary-row">
                      <span className="row-label">Do odjęcia:</span>
                      <strong>
                        −{deltaQty} {activeItem.unit}
                        {mode === 'percent' ? ` (${parsedValue}%)` : ''}
                      </strong>
                    </div>
                    <div className="confirm-summary-row">
                      <span className="row-label">Zostanie po zużyciu:</span>
                      <strong className={willDelete ? 'consume-will-delete' : ''}>
                        {willDelete
                          ? `0 ${activeItem.unit} (produkt zostanie usunięty)`
                          : `${remainingQty} / ${baseInitial} ${activeItem.unit} (${remainingPct}%)`}
                      </strong>
                    </div>
                  </>
                )}
              </div>

              <div
                className="segmented-control"
                role="tablist"
                aria-label="Sposób podania zużytej ilości"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'unit'}
                  className={`seg-btn ${mode === 'unit' ? 'active' : ''}`}
                  onClick={() => handleModeSwitch('unit')}
                >
                  Według ilości ({activeItem.unit})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'percent'}
                  className={`seg-btn ${mode === 'percent' ? 'active' : ''}`}
                  onClick={() => handleModeSwitch('percent')}
                >
                  Procentowo (%)
                </button>
              </div>

              <div className="field">
                <label htmlFor={`${titleId}-amount`}>
                  {mode === 'unit'
                    ? `Zużyta ilość (${activeItem.unit})`
                    : 'Zużyta część opakowania (%)'}
                </label>
                <div className="consume-input-wrap">
                  <input
                    id={`${titleId}-amount`}
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    required
                    disabled={submitting}
                    placeholder={mode === 'unit' ? 'np. 25' : 'np. 15'}
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    autoComplete="off"
                  />
                  <span className="consume-unit-badge">
                    {mode === 'unit' ? activeItem.unit : '%'}
                  </span>
                </div>
              </div>

              <div className="consume-presets-section">
                <span className="row-label">
                  {mode === 'unit'
                    ? `Szybkie podpowiedzi (${activeItem.unit}):`
                    : 'Szybkie podpowiedzi (%):'}
                </span>
                <div className="chip-group">
                  {mode === 'unit' ? (
                    <>
                      {unitPresets.map((val) => (
                        <button
                          key={val}
                          type="button"
                          disabled={submitting}
                          className={`chip-btn ${parsedValue === val ? 'active' : ''}`}
                          onClick={() => setAmountInput(String(val))}
                        >
                          −{val} {activeItem.unit}
                        </button>
                      ))}
                      {currentQty > 0 && (
                        <button
                          type="button"
                          disabled={submitting}
                          className={`chip-btn ${parsedValue === currentQty ? 'active' : ''}`}
                          onClick={() => setAmountInput(String(currentQty))}
                        >
                          Cała reszta ({currentQty} {activeItem.unit})
                        </button>
                      )}
                    </>
                  ) : (
                    PERCENT_PRESETS.map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        disabled={submitting}
                        className={`chip-btn ${parsedValue === pct ? 'active' : ''}`}
                        onClick={() => setAmountInput(String(pct))}
                      >
                        −{pct}%
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="dialog-footer confirm-footer">
              <button
                type="button"
                className="btn-secondary"
                disabled={submitting}
                onClick={onClose}
              >
                Anuluj
              </button>
              <button
                type="submit"
                className={willDelete ? 'btn-danger' : 'btn-primary'}
                disabled={!hasValidInput || submitting}
              >
                {submitting
                  ? 'Zapisywanie...'
                  : willDelete
                    ? 'Zużyj całość i usuń'
                    : 'Zastosuj zużycie'}
              </button>
            </div>
          </form>
        </div>
      )}
    </dialog>
  );
}
