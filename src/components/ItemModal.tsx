import React, { useRef, useState, useEffect, useId } from 'react';
import { InventoryItem, LabelStickerItem } from '../types';
import { useDialogModal, getExpiryBadgeInfo } from '../utils/dialogLightDismiss';

interface ItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  qrSvg: string;
  locations: string[];
  categories: string[];
  onConsumeAll: (serial: string) => void;
  onMarkOpened: (id: number) => void;
  onConsumePartial: (id: number, opts: { fraction?: number; delta?: number }) => void;
  onMoveLocation: (id: number, newLocation: string) => void;
  onUpdateItem: (
    id: number,
    patch: {
      name: string;
      brand: string;
      category: string;
      location: string;
      quantity: number;
      unit: string;
      expiry_date: string | null;
      notes: string;
    }
  ) => void;
  onReprintApi: (serial: string, copies: number) => void;
  onBrowserPrint: (items: LabelStickerItem[]) => void;
}

export function ItemModal({
  isOpen,
  onClose,
  item,
  qrSvg,
  locations,
  categories,
  onConsumeAll,
  onMarkOpened,
  onConsumePartial,
  onMoveLocation,
  onUpdateItem,
  onReprintApi,
  onBrowserPrint
}: ItemModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  useDialogModal(dialogRef, isOpen, onClose);

  const [copies, setCopies] = useState('1');
  const [editName, setEditName] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editQuantity, setEditQuantity] = useState('1');
  const [editUnit, setEditUnit] = useState('szt.');
  const [editExpiry, setEditExpiry] = useState('');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    if (item) {
      setCopies('1');
      setEditName(item.name || '');
      setEditBrand(item.brand || '');
      setEditCategory(item.category || categories[0] || 'Inne');
      setEditLocation(item.location || locations[0] || 'Spiżarnia');
      setEditQuantity(String(item.quantity));
      setEditUnit(item.unit || 'szt.');
      setEditExpiry(item.expiry_date || '');
      setEditNotes(item.notes || '');
    }
  }, [item, categories, locations]);

  const badge = item ? getExpiryBadgeInfo(item) : { cls: 'pill-none', marker: '[—]', text: '' };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    onUpdateItem(item.id, {
      name: editName.trim(),
      brand: editBrand.trim(),
      category: editCategory,
      location: editLocation,
      quantity: parseFloat(editQuantity.replace(',', '.')) || 1,
      unit: editUnit,
      expiry_date: editExpiry || null,
      notes: editNotes.trim()
    });
  };

  const handleBrowserPreview = () => {
    if (!item) return;
    const count = Math.min(20, Math.max(1, parseInt(copies, 10) || 1));
    const list: LabelStickerItem[] = [];
    for (let i = 0; i < count; i++) {
      list.push({
        serial_number: item.serial_number,
        name: item.name,
        qr_svg: qrSvg
      });
    }
    onBrowserPrint(list);
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
    >
      {item && (
        <div className="dialog-sheet">
          <div className="dialog-header">
            <div className="dialog-serial-group">
              <span className="serial-badge-large">{item.serial_number}</span>
              <span className={`expiry-pill ${badge.cls}`}>
                <span aria-hidden="true">{badge.marker}</span>
                <span>{badge.text}</span>
              </span>
            </div>
            <button
              type="button"
              className="dialog-close-btn"
              onClick={onClose}
              aria-label="Zamknij okno produktu"
            >
              Zamknij
            </button>
          </div>

          <div className="dialog-body">
            <div className="item-hero">
              <div
                className="item-qr-box"
                aria-label="Kod QR produktu"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div className="item-hero-info">
                <h2 id={titleId} className="modal-product-title">
                  {item.name}
                </h2>
                <p className="modal-product-meta">
                  {[item.brand, item.category].filter(Boolean).join(' • ')}
                </p>
                <div className="modal-tags">
                  <span className="meta-tag">{item.location}</span>
                  {item.is_opened ? (
                    <span className="meta-tag tag-opened">Otwarte</span>
                  ) : (
                    <span className="meta-tag">Zamknięte</span>
                  )}
                  {item.ean && <span className="meta-tag">EAN: {item.ean}</span>}
                </div>
              </div>
            </div>

            <div className="quantity-meter-box">
              <div className="quantity-meter-header">
                <span>Pozostała ilość:</span>
                <strong>
                  {item.quantity} / {item.initial_quantity} {item.unit} ({item.percent_remaining}%)
                </strong>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={item.percent_remaining}
              >
                <div
                  className="progress-fill"
                  style={{ width: `${item.percent_remaining}%` }}
                />
              </div>
            </div>

            <div className="quick-actions-section">
              <h3 className="section-mini-title">Szybkie akcje po zeskanowaniu</h3>
              <div className="primary-scan-actions">
                <button
                  type="button"
                  className="btn-danger btn-large"
                  onClick={() => onConsumeAll(item.serial_number)}
                  autoFocus
                >
                  Zużyto / Usuń z magazynu
                </button>
                <button
                  type="button"
                  className="btn-warning btn-large"
                  onClick={() => onMarkOpened(item.id)}
                >
                  {item.is_opened ? 'Już otwarte (odśwież datę)' : 'Oznacz jako otwarte'}
                </button>
              </div>

              <div className="partial-consume-row">
                <span className="row-label">Zużyj częściowo:</span>
                <div className="chip-group">
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => onConsumePartial(item.id, { fraction: 0.25 })}
                  >
                    −25%
                  </button>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => onConsumePartial(item.id, { fraction: 0.5 })}
                  >
                    −50%
                  </button>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => onConsumePartial(item.id, { delta: 1 })}
                  >
                    −1 jedn.
                  </button>
                </div>
              </div>

              <div className="move-location-row">
                <span className="row-label">Przenieś do:</span>
                <div className="chip-group">
                  {locations.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      className={`chip-btn ${item.location === loc ? 'active' : ''}`}
                      onClick={() => onMoveLocation(item.id, loc)}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <details className="edit-details">
              <summary>Edytuj szczegóły produktu lub datę ważności</summary>
              <form onSubmit={handleEditSubmit} className="stacked-form compact-form">
                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor={`${titleId}-name`}>Nazwa produktu</label>
                    <input
                      type="text"
                      id={`${titleId}-name`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${titleId}-brand`}>Marka</label>
                    <input
                      type="text"
                      id={`${titleId}-brand`}
                      value={editBrand}
                      onChange={(e) => setEditBrand(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor={`${titleId}-loc`}>Lokalizacja</label>
                    <select
                      id={`${titleId}-loc`}
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                    >
                      {locations.map((loc) => (
                        <option key={loc} value={loc}>
                          {loc}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`${titleId}-cat`}>Kategoria</label>
                    <select
                      id={`${titleId}-cat`}
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                    >
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row-3">
                  <div className="field">
                    <label htmlFor={`${titleId}-qty`}>Aktualna ilość</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      id={`${titleId}-qty`}
                      value={editQuantity}
                      onChange={(e) => setEditQuantity(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${titleId}-unit`}>Jednostka</label>
                    <select
                      id={`${titleId}-unit`}
                      value={editUnit}
                      onChange={(e) => setEditUnit(e.target.value)}
                    >
                      <option value="szt.">szt.</option>
                      <option value="g">g</option>
                      <option value="kg">kg</option>
                      <option value="ml">ml</option>
                      <option value="l">l</option>
                      <option value="opak.">opak.</option>
                      <option value="porcje">porcje</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`${titleId}-exp`}>Data ważności</label>
                    <input
                      type="date"
                      id={`${titleId}-exp`}
                      value={editExpiry}
                      onChange={(e) => setEditExpiry(e.target.value)}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`${titleId}-notes`}>Notatka</label>
                  <input
                    type="text"
                    id={`${titleId}-notes`}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn-primary">
                  Zapisz zmiany
                </button>
              </form>
            </details>
          </div>

          <div className="dialog-footer dialog-footer-reprint">
            <div className="reprint-copies-inline">
              <label htmlFor={`${titleId}-copies`}>Kopie:</label>
              <input
                type="text"
                inputMode="numeric"
                id={`${titleId}-copies`}
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
                aria-label="Liczba kopii etykiety do dodruku"
              />
            </div>
            <div className="dialog-footer-buttons">
              <button
                type="button"
                className="btn-primary"
                onClick={() => onReprintApi(item.serial_number, parseInt(copies, 10) || 1)}
              >
                Dodrukuj etykietę (API)
              </button>
              <button type="button" className="btn-secondary" onClick={handleBrowserPreview}>
                Podgląd wydruku
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

