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
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useDialogModal(dialogRef, isOpen, onClose);

  const [displayItem, setDisplayItem] = useState<InventoryItem | null>(item);
  const [activeTab, setActiveTab] = useState<'actions' | 'edit'>('actions');
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
      setDisplayItem(item);
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

  useEffect(() => {
    if (isOpen) {
      setActiveTab('actions');
    }
  }, [isOpen, item?.id]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const activeData = item ?? displayItem;
  const badge = activeData ? getExpiryBadgeInfo(activeData) : { cls: 'pill-none', marker: '[—]', text: '' };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeData) return;
    onUpdateItem(activeData.id, {
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
    if (!activeData) return;
    const count = Math.min(20, Math.max(1, parseInt(copies, 10) || 1));
    const list: LabelStickerItem[] = [];
    for (let i = 0; i < count; i++) {
      list.push({
        serial_number: activeData.serial_number,
        name: activeData.name,
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
      {activeData && (
        <div className="dialog-sheet">
          <div className="dialog-header">
            <div className="dialog-serial-group">
              <span className="serial-badge-large">{activeData.serial_number}</span>
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

          <div className="dialog-body" ref={bodyRef}>
            <div key={activeTab} className="dialog-tab-panel">
              {activeTab === 'actions' ? (
                <>
                  <div className="item-hero">
                    <div
                      className="item-qr-box"
                      aria-label="Kod QR produktu"
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                    <div className="item-hero-info">
                      <h2 id={titleId} className="modal-product-title">
                        {activeData.name}
                      </h2>
                      <p className="modal-product-meta">
                        {[activeData.brand, activeData.category].filter(Boolean).join(' • ')}
                      </p>
                      <div className="modal-tags">
                        <span className="meta-tag">{activeData.location}</span>
                        {activeData.is_opened ? (
                          <span className="meta-tag tag-opened">Otwarte</span>
                        ) : (
                          <span className="meta-tag">Zamknięte</span>
                        )}
                        {activeData.ean && <span className="meta-tag">EAN: {activeData.ean}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="quantity-meter-box">
                    <div className="quantity-meter-header">
                      <span>Pozostała ilość:</span>
                      <strong>
                        {activeData.quantity} / {activeData.initial_quantity} {activeData.unit} (
                        {activeData.percent_remaining}%)
                      </strong>
                    </div>
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={activeData.percent_remaining}
                    >
                      <div
                        className="progress-fill"
                        style={{ width: `${activeData.percent_remaining}%` }}
                      />
                    </div>
                  </div>

                  <div className="quick-actions-section">
                    <h3 className="section-mini-title">Szybkie akcje</h3>
                    <div className="primary-scan-actions">
                      <button
                        type="button"
                        className="btn-danger btn-large"
                        onClick={() => onConsumeAll(activeData.serial_number)}
                      >
                        Zużyto / Usuń
                      </button>
                      <button
                        type="button"
                        className="btn-warning btn-large"
                        onClick={() => onMarkOpened(activeData.id)}
                      >
                        {activeData.is_opened ? 'Odśwież otwarcie' : 'Oznacz otwarte'}
                      </button>
                    </div>

                    <div className="partial-consume-row">
                      <span className="row-label">Zużyj częściowo:</span>
                      <div className="chip-group">
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => onConsumePartial(activeData.id, { fraction: 0.25 })}
                        >
                          −25%
                        </button>
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => onConsumePartial(activeData.id, { fraction: 0.5 })}
                        >
                          −50%
                        </button>
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => onConsumePartial(activeData.id, { delta: 1 })}
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
                            className={`chip-btn ${activeData.location === loc ? 'active' : ''}`}
                            onClick={() => onMoveLocation(activeData.id, loc)}
                          >
                            {loc}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <form id={`${titleId}-edit-form`} onSubmit={handleEditSubmit} className="stacked-form compact-form">
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
                  <button type="submit" className="btn-primary btn-lg">
                    Zapisz zmiany
                  </button>
                </form>
              )}
            </div>
          </div>

          {activeTab === 'actions' && (
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
                  onClick={() => onReprintApi(activeData.serial_number, parseInt(copies, 10) || 1)}
                >
                  Dodrukuj API
                </button>
                <button type="button" className="btn-secondary" onClick={handleBrowserPreview}>
                  Podgląd
                </button>
              </div>
            </div>
          )}

          <div className="dialog-bottom-tabs">
            <div className="segmented-control" role="tablist" aria-label="Widok karty produktu">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'actions'}
                className={`seg-btn ${activeTab === 'actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('actions')}
              >
                Szczegóły i akcje
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'edit'}
                className={`seg-btn ${activeTab === 'edit' ? 'active' : ''}`}
                onClick={() => setActiveTab('edit')}
              >
                Edycja produktu
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

