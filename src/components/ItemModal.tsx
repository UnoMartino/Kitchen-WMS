import React, { useRef, useState, useEffect, useId } from 'react';
import { InventoryItem } from '../types';
import { useDialogModal, getExpiryBadgeInfo } from '../utils/dialogLightDismiss';

interface ItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  qrSvg: string;
  locations: string[];
  categories: string[];
  onConsumeAll: (serial: string) => void;
  onToggleOpened: (id: number, opened: boolean) => void;
  onConsumePartial: (id: number, opts: { fraction?: number; delta?: number }) => void;
  onMoveLocation: (id: number, newLocation: string) => void;
  onUpdateItem: (
    id: number,
    patch: {
      name: string;
      brand: string;
      ean: string;
      category: string;
      location: string;
      quantity: number;
      initial_quantity: number;
      unit: string;
      expiry_date: string | null;
      notes: string;
    }
  ) => void;
  onRequestPrint: (serial: string, copies: number, itemName?: string) => void;
  onSelectSibling: (item: InventoryItem) => void;
  onOpenCustomConsume: (item: InventoryItem) => void;
}

export function ItemModal({
  isOpen,
  onClose,
  item,
  qrSvg,
  locations,
  categories,
  onConsumeAll,
  onToggleOpened,
  onConsumePartial,
  onMoveLocation,
  onUpdateItem,
  onRequestPrint,
  onSelectSibling,
  onOpenCustomConsume
}: ItemModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useDialogModal(dialogRef, isOpen, onClose);

  const [displayItem, setDisplayItem] = useState<InventoryItem | null>(item);
  const [activeTab, setActiveTab] = useState<'actions' | 'print' | 'edit'>('actions');
  const [siblingsOpen, setSiblingsOpen] = useState(false);
  const [copies, setCopies] = useState(1);
  const [editName, setEditName] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editEan, setEditEan] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editQuantity, setEditQuantity] = useState('1');
  const [editInitialQuantity, setEditInitialQuantity] = useState('1');
  const [qtyManuallyEdited, setQtyManuallyEdited] = useState(false);
  const [editUnit, setEditUnit] = useState('szt.');
  const [editExpiry, setEditExpiry] = useState('');
  const [editNoExpiry, setEditNoExpiry] = useState(false);
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    if (item) {
      setDisplayItem(item);
      setCopies(1);
      setEditName(item.name || '');
      setEditBrand(item.brand || '');
      setEditEan(item.ean || '');
      setEditCategory(item.category || categories[0] || 'Inne');
      setEditLocation(item.location || locations[0] || 'Spiżarnia');
      setEditQuantity(String(item.quantity));
      setEditInitialQuantity(String(Math.max(item.initial_quantity || 1, item.quantity || 1)));
      setQtyManuallyEdited(false);
      setEditUnit(item.unit || 'szt.');
      setEditExpiry(item.expiry_date || '');
      setEditNoExpiry(!item.expiry_date);
      setEditNotes(item.notes || '');
    }
  }, [item, categories, locations]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('actions');
      setSiblingsOpen(false);
    }
  }, [isOpen, item?.id]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const activeData = item ?? displayItem;
  const siblings = activeData?.same_ean_items || [];
  const siblingsCount = activeData?.same_ean_count ?? siblings.length;
  const badge = activeData
    ? getExpiryBadgeInfo(activeData)
    : { cls: 'pill-none', marker: '[—]', text: '' };

  const handleEditQuantityChange = (val: string) => {
    setQtyManuallyEdited(true);
    setEditQuantity(val);
    const parsedQty = parseFloat(val.replace(',', '.'));
    const parsedInit = parseFloat(editInitialQuantity.replace(',', '.'));
    if (
      activeData &&
      Number.isFinite(parsedQty) &&
      parsedQty > 0 &&
      (activeData.quantity === activeData.initial_quantity ||
        !Number.isFinite(parsedInit) ||
        parsedQty > parsedInit ||
        parsedInit <= 1)
    ) {
      setEditInitialQuantity(val);
    }
  };

  const handleEditInitialQuantityChange = (val: string) => {
    setEditInitialQuantity(val);
    const nextInit = parseFloat(val.replace(',', '.'));
    if (
      activeData &&
      !qtyManuallyEdited &&
      activeData.initial_quantity <= 1 &&
      activeData.quantity > 0 &&
      activeData.quantity <= 1 &&
      Number.isFinite(nextInit) &&
      nextInit > 1
    ) {
      const scaled = Math.round(activeData.quantity * nextInit * 100) / 100;
      setEditQuantity(String(scaled));
    }
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeData) return;
    const parsedQty = Math.max(0.01, parseFloat(editQuantity.replace(',', '.')) || 1);
    const parsedInit = Math.max(
      parsedQty,
      parseFloat(editInitialQuantity.replace(',', '.')) || parsedQty
    );
    onUpdateItem(activeData.id, {
      name: editName.trim(),
      brand: editBrand.trim(),
      ean: editEan.replace(/\D/g, '').trim(),
      category: editCategory,
      location: editLocation,
      quantity: parsedQty,
      initial_quantity: parsedInit,
      unit: editUnit,
      expiry_date: editNoExpiry ? null : editExpiry || null,
      notes: editNotes.trim()
    });
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
              {activeTab === 'actions' && (
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
                        {activeData.ean &&
                          (siblings.length > 0 ? (
                            <button
                              type="button"
                              className={`meta-tag tag-siblings-btn ${siblingsOpen ? 'active' : ''}`}
                              aria-expanded={siblingsOpen}
                              aria-controls={`${titleId}-siblings-list`}
                              onClick={() => setSiblingsOpen((prev) => !prev)}
                            >
                              Inne sztuki: {siblingsCount} {siblingsOpen ? '▴' : '▾'}
                            </button>
                          ) : (
                            <span className="meta-tag">Inne sztuki: 0</span>
                          ))}
                      </div>
                    </div>
                  </div>

                  {siblingsOpen && siblings.length > 0 && (
                    <div id={`${titleId}-siblings-list`} className="same-ean-list-box">
                      <div className="same-ean-list-title">
                        Pozostałe sztuki tego produktu w magazynie ({siblings.length})
                      </div>
                      <div className="same-ean-list">
                        {siblings.map((sib) => {
                          const sibBadge = getExpiryBadgeInfo(sib);
                          return (
                            <button
                              key={sib.id}
                              type="button"
                              className="sibling-item-row"
                              onClick={() => onSelectSibling(sib)}
                            >
                              <div className="sibling-row-top">
                                <span className="serial-chip">{sib.serial_number}</span>
                                <span className={`expiry-pill ${sibBadge.cls}`}>
                                  <span aria-hidden="true">{sibBadge.marker}</span>
                                  <span>{sibBadge.text}</span>
                                </span>
                              </div>
                              <div className="sibling-row-meta">
                                <span>
                                  {sib.location}
                                  {sib.is_opened ? ' • Otwarte' : ''} • {sib.quantity}/
                                  {sib.initial_quantity} {sib.unit}
                                </span>
                                <span>{sib.expiry_date || 'Bez terminu'} • Otwórz →</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="quantity-meter-box">
                    <div className="quantity-meter-header">
                      <span>Pozostała ilość:</span>
                      <strong>
                        {activeData.quantity} / {activeData.initial_quantity} {activeData.unit} (
                        {activeData.percent_remaining}%)
                      </strong>
                    </div>
                    <progress
                      className={`consumption-progress ${
                        activeData.percent_remaining <= 25
                          ? 'low'
                          : activeData.percent_remaining <= 50
                            ? 'medium'
                            : ''
                      }`}
                      value={activeData.percent_remaining}
                      max={100}
                      aria-label={`Pozostała ilość: ${activeData.percent_remaining}%`}
                    />
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
                        className={activeData.is_opened ? 'btn-secondary btn-large' : 'btn-warning btn-large'}
                        onClick={() => onToggleOpened(activeData.id, !activeData.is_opened)}
                      >
                        {activeData.is_opened ? 'Oznacz jako zamknięte' : 'Oznacz otwarte'}
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
                        <button
                          type="button"
                          className="chip-btn chip-btn-more"
                          onClick={() => onOpenCustomConsume(activeData)}
                        >
                          Inne
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
              )}

              {activeTab === 'print' && (
                <div className="print-tab-panel">
                  <div className="print-label-card">
                    <span className="serial-badge-large">{activeData.serial_number}</span>
                    <h2 id={titleId} className="modal-product-title">
                      {activeData.name}
                    </h2>
                    <p className="modal-product-meta">
                      {[activeData.brand, activeData.location].filter(Boolean).join(' • ')}
                    </p>
                  </div>

                  <div className="print-controls-box">
                    <div className="batch-control">
                      <label htmlFor={`${titleId}-copies`}>Liczba kopii etykiety:</label>
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
                          onChange={(e) =>
                            setCopies(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)))
                          }
                          aria-label="Liczba kopii etykiety do dodruku"
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

                    <button
                      type="button"
                      className="btn-primary btn-lg"
                      onClick={() =>
                        onRequestPrint(activeData.serial_number, copies, activeData.name)
                      }
                    >
                      Dodrukuj etykietę
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'edit' && (
                <form
                  id={`${titleId}-edit-form`}
                  onSubmit={handleEditSubmit}
                  className="stacked-form compact-form"
                  aria-labelledby={titleId}
                >
                  <h2 id={titleId} className="visually-hidden">
                    Edycja produktu {activeData.name}
                  </h2>
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

                  <div className="form-row-2">
                    <div className="field">
                      <label htmlFor={`${titleId}-qty`}>Aktualna ilość</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        id={`${titleId}-qty`}
                        value={editQuantity}
                        onChange={(e) => handleEditQuantityChange(e.target.value)}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`${titleId}-init-qty`}>Wielkość opakowania</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        id={`${titleId}-init-qty`}
                        value={editInitialQuantity}
                        onChange={(e) => handleEditInitialQuantityChange(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="field">
                      <label htmlFor={`${titleId}-unit`}>Jednostka</label>
                      <select
                        id={`${titleId}-unit`}
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value)}
                      >
                        <option value="szt.">szt.</option>
                        <option value="opak.">opak.</option>
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                        <option value="ml">ml</option>
                        <option value="l">l</option>
                        <option value="słoik">słoik</option>
                        <option value="puszka">puszka</option>
                        <option value="porcje">porcje</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`${titleId}-ean`}>Kod EAN</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        id={`${titleId}-ean`}
                        placeholder="opcjonalnie 8–14 cyfr"
                        value={editEan}
                        onChange={(e) => setEditEan(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  <div className="field">
                    <label className="ios-switch-row" htmlFor={`${titleId}-no-exp`}>
                      <span>Bez terminu ważności</span>
                      <input
                        type="checkbox"
                        role="switch"
                        className="ios-switch"
                        id={`${titleId}-no-exp`}
                        checked={editNoExpiry}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setEditNoExpiry(checked);
                          if (checked) {
                            setEditExpiry('');
                          }
                        }}
                      />
                    </label>
                  </div>

                  <div className="field">
                    <label htmlFor={`${titleId}-exp`}>Data ważności</label>
                    <input
                      type="date"
                      id={`${titleId}-exp`}
                      value={editNoExpiry ? '' : editExpiry}
                      disabled={editNoExpiry}
                      onChange={(e) => {
                        setEditExpiry(e.target.value);
                        if (e.target.value) setEditNoExpiry(false);
                      }}
                    />
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

          <div className="dialog-bottom-tabs">
            <div className="segmented-control" role="tablist" aria-label="Widok karty produktu">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'actions'}
                className={`seg-btn ${activeTab === 'actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('actions')}
              >
                Szczegóły
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'print'}
                className={`seg-btn ${activeTab === 'print' ? 'active' : ''}`}
                onClick={() => setActiveTab('print')}
              >
                Drukuj
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'edit'}
                className={`seg-btn ${activeTab === 'edit' ? 'active' : ''}`}
                onClick={() => setActiveTab('edit')}
              >
                Edycja
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
