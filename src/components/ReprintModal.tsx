import React, { useRef, useState, useEffect, useId } from 'react';
import { InventoryItem } from '../types';
import { useDialogModal } from '../utils/dialogLightDismiss';

interface ReprintModalProps {
  isOpen: boolean;
  onClose: () => void;
  allItems: InventoryItem[];
  initialSelectedSerials: string[];
  onExecuteBatchReprint: (opts: {
    serialNumbers?: string | string[];
    fromSerial?: string;
    toSerial?: string;
    copies: number;
  }) => void;
  onReprintSingle: (serial: string, copies: number, itemName?: string) => void;
}

export function ReprintModal({
  isOpen,
  onClose,
  allItems,
  initialSelectedSerials,
  onExecuteBatchReprint,
  onReprintSingle
}: ReprintModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useDialogModal(dialogRef, isOpen, onClose);

  const [activeTab, setActiveTab] = useState<'select' | 'range'>('select');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [fromSerial, setFromSerial] = useState('');
  const [toSerial, setToSerial] = useState('');
  const [serialListText, setSerialListText] = useState('');
  const [copies, setCopies] = useState(1);

  useEffect(() => {
    if (isOpen) {
      setSelectedSet(new Set(initialSelectedSerials));
      setSearchFilter('');
      setCopies(1);
    }
  }, [isOpen, initialSelectedSerials]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const filteredItems = allItems.filter((item) => {
    const term = searchFilter.trim().toLowerCase();
    if (!term) return true;
    return (
      item.serial_number.toLowerCase().includes(term) ||
      item.name.toLowerCase().includes(term) ||
      item.location.toLowerCase().includes(term)
    );
  });

  const toggleSerial = (serial: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return next;
    });
  };

  const checkAllFiltered = () => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      for (const item of filteredItems) next.add(item.serial_number);
      return next;
    });
  };

  const uncheckAll = () => {
    setSelectedSet(new Set());
  };

  const triggerAction = () => {
    const validCopies = Math.max(1, Math.min(20, copies));
    if (activeTab === 'select') {
      onExecuteBatchReprint({
        serialNumbers: Array.from(selectedSet),
        copies: validCopies
      });
    } else {
      if (fromSerial.trim() && toSerial.trim()) {
        onExecuteBatchReprint({
          fromSerial: fromSerial.trim(),
          toSerial: toSerial.trim(),
          copies: validCopies
        });
      } else {
        onExecuteBatchReprint({
          serialNumbers: serialListText.trim(),
          copies: validCopies
        });
      }
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
    >
      <div className="dialog-sheet">
        <div className="dialog-header">
          <h2 id={titleId}>Dodruk etykiet QR (pojedynczy i seryjny)</h2>
          <button
            type="button"
            className="dialog-close-btn"
            onClick={onClose}
            aria-label="Zamknij okno dodruku"
          >
            Zamknij
          </button>
        </div>

        <div className="dialog-body" ref={bodyRef}>
          <div key={activeTab} className="dialog-tab-panel">
            {activeTab === 'select' ? (
              <div className="reprint-pane">
                <div className="reprint-filter-row">
                  <label htmlFor={`${titleId}-search`} className="visually-hidden">
                    Filtruj produkty do dodruku
                  </label>
                  <input
                    type="search"
                    id={`${titleId}-search`}
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Szukaj..."
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <button type="button" className="chip-btn" onClick={checkAllFiltered}>
                    Zaznacz widoczne
                  </button>
                  <button type="button" className="chip-btn" onClick={uncheckAll}>
                    Odznacz
                  </button>
                </div>

                <div className="reprint-checklist">
                  {filteredItems.length === 0 ? (
                    <div style={{ padding: '1rem' }} className="hint-text">
                      Brak pozycji pasujących do filtra.
                    </div>
                  ) : (
                    filteredItems.map((item) => {
                      const checked = selectedSet.has(item.serial_number);
                      return (
                        <label key={item.serial_number} className="reprint-check-row">
                          <span className="reprint-check-main">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSerial(item.serial_number)}
                            />
                            <code className="serial-chip">{item.serial_number}</code>
                            <span>
                              <strong>{item.name}</strong>{' '}
                              <span className="hint-text">({item.location})</span>
                            </span>
                          </span>
                          <button
                            type="button"
                            className="chip-btn"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onReprintSingle(item.serial_number, 1, item.name);
                            }}
                          >
                            Dodrukuj etykietę
                          </button>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="reprint-pane stacked-form">
                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor={`${titleId}-from`}>Od numeru seryjnego:</label>
                    <input
                      type="text"
                      id={`${titleId}-from`}
                      value={fromSerial}
                      onChange={(e) => setFromSerial(e.target.value)}
                      placeholder="np. AAA-0001 lub 1"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${titleId}-to`}>Do numeru seryjnego:</label>
                    <input
                      type="text"
                      id={`${titleId}-to`}
                      value={toSerial}
                      onChange={(e) => setToSerial(e.target.value)}
                      placeholder="np. AAA-0010 lub 10"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`${titleId}-list`}>
                    Lub wpisz numery seryjne (po przecinku albo w nowych liniach):
                  </label>
                  <textarea
                    id={`${titleId}-list`}
                    rows={3}
                    value={serialListText}
                    onChange={(e) => setSerialListText(e.target.value)}
                    placeholder="np. AAA-0001, AAA-0003, AAA-0008"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                  <span className="field-hint">
                    Jeśli wypełnisz zakres „Od – Do”, wygeneruje on wszystkie kolejne etykiety w tym przedziale.
                  </span>
                </div>
              </div>
            )}

            <div className="batch-print-bar">
              <div className="batch-control">
                <label htmlFor={`${titleId}-copies`}>Liczba kopii dla każdej pozycji:</label>
                <div className="stepper">
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() => setCopies((c) => Math.max(1, c - 1))}
                    aria-label="Zmniejsz liczbę kopii"
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    id={`${titleId}-copies`}
                    value={copies}
                    onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    aria-label="Liczba kopii na etykietę"
                  />
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() => setCopies((c) => Math.min(20, c + 1))}
                    aria-label="Zwiększ liczbę kopii"
                  >
                    +
                  </button>
                </div>
              </div>
              <span className="hint-text">
                {activeTab === 'select'
                  ? `Wybrano pozycji: ${selectedSet.size} (łącznie etykiet: ${selectedSet.size * copies})`
                  : `Tryb zakresu / listy (kopii na pozycję: ${copies})`}
              </span>
            </div>
          </div>
        </div>

        <div className="dialog-footer">
          <button
            type="button"
            className="btn-primary"
            onClick={triggerAction}
          >
            Dodrukuj etykietę
          </button>
        </div>

        <div className="dialog-bottom-tabs">
          <div className="segmented-control" role="tablist" aria-label="Tryb dodruku etykiet">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'select'}
              className={`seg-btn ${activeTab === 'select' ? 'active' : ''}`}
              onClick={() => setActiveTab('select')}
            >
              Wybierz z listy
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'range'}
              className={`seg-btn ${activeTab === 'range' ? 'active' : ''}`}
              onClick={() => setActiveTab('range')}
            >
              Zakres numerów
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

