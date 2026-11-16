import React, { useRef, useState, useEffect, useId } from 'react';
import { AppSettings, ActivityEntry } from '../types';
import { useDialogModal } from '../utils/dialogLightDismiss';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings | null;
  activity: ActivityEntry[];
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onTestPrinter: (printerConfig: Partial<AppSettings>) => Promise<void>;
  onRestoreActivity: (activityId: number) => Promise<void>;
  onReprintSerial: (serial: string, itemName?: string) => void;
  onExportDatabase: () => Promise<void>;
  onRequestImportFile: (file: File) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  activity,
  onSaveSettings,
  onTestPrinter,
  onRestoreActivity,
  onReprintSerial,
  onExportDatabase,
  onRequestImportFile
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  useDialogModal(dialogRef, isOpen, onClose);

  const [activeTab, setActiveTab] = useState<'general' | 'taxonomy' | 'history'>('general');
  const [exportingDb, setExportingDb] = useState(false);

  const [printerUrl, setPrinterUrl] = useState('http://10.10.20.2:8769/print');
  const [qrMode, setQrMode] = useState<'serial' | 'url'>('serial');
  const [warningDays, setWarningDays] = useState('7');
  const [qrBaseUrl, setQrBaseUrl] = useState('');
  const [autoPrint, setAutoPrint] = useState(true);

  const [locations, setLocations] = useState<string[]>([]);
  const [newLocation, setNewLocation] = useState('');

  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (settings && isOpen) {
      setPrinterUrl(settings.printer_api_url || 'http://10.10.20.2:8769/print');
      setQrMode(settings.printer_qr_mode || 'serial');
      setWarningDays(settings.expiry_warning_days || '7');
      setQrBaseUrl(settings.printer_qr_base_url || '');
      setAutoPrint(settings.printer_auto_print !== 'false');
      setLocations(settings.locations || []);
      setCategories(settings.categories || []);
    }
  }, [settings, isOpen]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings({
      printer_api_url: printerUrl.trim(),
      printer_qr_mode: qrMode,
      expiry_warning_days: warningDays.trim(),
      printer_qr_base_url: qrBaseUrl.trim(),
      printer_auto_print: autoPrint ? 'true' : 'false',
      locations,
      categories
    });
  };

  const addLocation = () => {
    const val = newLocation.trim();
    if (!val || locations.includes(val)) return;
    const updated = [...locations, val];
    setLocations(updated);
    setNewLocation('');
    onSaveSettings({ locations: updated });
  };

  const removeLocation = (loc: string) => {
    if (locations.length <= 1) return;
    const updated = locations.filter((l) => l !== loc);
    setLocations(updated);
    onSaveSettings({ locations: updated });
  };

  const moveLocation = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= locations.length) return;
    const copy = [...locations];
    const [item] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, item);
    setLocations(copy);
    onSaveSettings({ locations: copy });
  };

  const addCategory = () => {
    const val = newCategory.trim();
    if (!val || categories.includes(val)) return;
    const updated = [...categories, val];
    setCategories(updated);
    setNewCategory('');
    onSaveSettings({ categories: updated });
  };

  const removeCategory = (cat: string) => {
    if (categories.length <= 1) return;
    const updated = categories.filter((c) => c !== cat);
    setCategories(updated);
    onSaveSettings({ categories: updated });
  };

  const moveCategory = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= categories.length) return;
    const copy = [...categories];
    const [item] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, item);
    setCategories(copy);
    onSaveSettings({ categories: copy });
  };

  const actionLabels: Record<string, string> = {
    added: 'Dodano',
    consumed: 'Zużyto',
    deleted: 'Usunięto',
    opened: 'Otwarto',
    closed: 'Zamknięto',
    updated: 'Edytowano',
    printed: 'Wydrukowano QR',
    restored: 'Przywrócono'
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
    >
      <div className="dialog-sheet">
        <div className="dialog-header">
          <h2 id={titleId}>Ustawienia systemu</h2>
          <button
            type="button"
            className="dialog-close-btn"
            onClick={onClose}
            aria-label="Zamknij ustawienia"
          >
            Zamknij
          </button>
        </div>

        <div className="dialog-body" ref={bodyRef}>
          <div key={activeTab} className="dialog-tab-panel">
            {activeTab === 'general' && (
              <>
              <form onSubmit={handleSaveAll} className="stacked-form">
                <div className="field">
                  <label htmlFor={`${titleId}-printer`}>Adres API drukarki etykiet (POST JSON):</label>
                  <input
                    type="url"
                    id={`${titleId}-printer`}
                    value={printerUrl}
                    onChange={(e) => setPrinterUrl(e.target.value)}
                    placeholder="http://10.10.20.2:8769/print"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                  <span className="field-hint">
                    Wysyła <code>POST {`{"text": "AAA-0001", "qr_text": "..."}`}</code> przy dodawaniu pozycji lub dodruku.
                  </span>
                </div>

                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor={`${titleId}-qrmode`}>
                      Zawartość kodu QR (pole <code>qr_text</code>):
                    </label>
                    <select
                      id={`${titleId}-qrmode`}
                      value={qrMode}
                      onChange={(e) => setQrMode(e.target.value as 'serial' | 'url')}
                    >
                      <option value="serial">Numer seryjny (np. AAA-0001)</option>
                      <option value="url">Pełny link URL (np. http://.../AAA-0001)</option>
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor={`${titleId}-days`}>Próg „Wkrótce wygasną” (dni):</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      id={`${titleId}-days`}
                      value={warningDays}
                      onChange={(e) => setWarningDays(e.target.value)}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`${titleId}-base`}>Własny prefiks URL dla kodów QR (opcjonalnie):</label>
                  <input
                    type="url"
                    id={`${titleId}-base`}
                    value={qrBaseUrl}
                    onChange={(e) => setQrBaseUrl(e.target.value)}
                    placeholder="np. http://10.10.20.5:3000"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </div>

                <label className="ios-switch-row" htmlFor={`${titleId}-auto`}>
                  <span>Automatycznie drukuj etykietę po dodaniu produktu</span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="ios-switch"
                    id={`${titleId}-auto`}
                    checked={autoPrint}
                    onChange={(e) => setAutoPrint(e.target.checked)}
                  />
                </label>

                <div className="settings-actions-row">
                  <button type="submit" className="btn-primary">
                    Zapisz ustawienia
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      onTestPrinter({
                        printer_api_url: printerUrl.trim(),
                        printer_qr_mode: qrMode,
                        printer_qr_base_url: qrBaseUrl.trim()
                      })
                    }
                  >
                    Wydruk testowy
                  </button>
                </div>
              </form>

              <div className="database-backup-box">
                <h3>Kopia zapasowa bazy danych</h3>
                <p className="field-hint">
                  Eksportuj wszystkie produkty, katalog kodów EAN, lokalizacje, kategorie i historię do pliku JSON lub wczytaj zapisaną kopię.
                </p>
                <div className="settings-actions-row">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={exportingDb}
                    onClick={async () => {
                      setExportingDb(true);
                      try {
                        await onExportDatabase();
                      } finally {
                        setExportingDb(false);
                      }
                    }}
                  >
                    {exportingDb ? 'Eksportowanie...' : 'Eksportuj bazę danych'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => importInputRef.current?.click()}
                  >
                    Importuj bazę danych
                  </button>
                  <label htmlFor={`${titleId}-import-file`} className="visually-hidden">
                    Wybierz plik kopii zapasowej bazy danych JSON
                  </label>
                  <input
                    ref={importInputRef}
                    id={`${titleId}-import-file`}
                    type="file"
                    accept=".json,application/json"
                    className="visually-hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) {
                        onRequestImportFile(file);
                      }
                    }}
                  />
                </div>
              </div>
              </>
            )}

            {activeTab === 'taxonomy' && (
              <div className="taxonomy-editor-grid">
                {/* Configurable Locations */}
                <div className="taxonomy-box">
                  <h3>Lokalizacje przechowywania ({locations.length})</h3>
                  <p className="field-hint">
                    Dodawaj lub usuwaj miejsca przechowywania w kuchni (np. Spiżarnia, Lodówka, Piwnica).
                  </p>
                  <div className="input-with-button" style={{ marginTop: '0.5rem' }}>
                    <label htmlFor={`${titleId}-new-loc`} className="visually-hidden">
                      Nowa lokalizacja
                    </label>
                    <input
                      type="text"
                      id={`${titleId}-new-loc`}
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addLocation();
                        }
                      }}
                      placeholder="Nowa lokalizacja, np. Piwnica..."
                    />
                    <button type="button" className="btn-primary btn-sm" onClick={addLocation}>
                      Dodaj
                    </button>
                  </div>

                  <ul className="taxonomy-list">
                    {locations.map((loc, idx) => (
                      <li key={loc} className="taxonomy-item">
                        <span className="taxonomy-name">{loc}</span>
                        <div className="taxonomy-actions">
                          <button
                            type="button"
                            className="chip-btn"
                            disabled={idx === 0}
                            onClick={() => moveLocation(idx, -1)}
                            aria-label={`Przesuń ${loc} wyżej`}
                          >
                            Góra
                          </button>
                          <button
                            type="button"
                            className="chip-btn"
                            disabled={idx === locations.length - 1}
                            onClick={() => moveLocation(idx, 1)}
                            aria-label={`Przesuń ${loc} niżej`}
                          >
                            Dół
                          </button>
                          <button
                            type="button"
                            className="chip-btn btn-card-delete"
                            disabled={locations.length <= 1}
                            onClick={() => removeLocation(loc)}
                            aria-label={`Usuń lokalizację ${loc}`}
                          >
                            Usuń
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Configurable Categories */}
                <div className="taxonomy-box">
                  <h3>Kategorie produktów ({categories.length})</h3>
                  <p className="field-hint">
                    Dostosuj listę kategorii używanych przy dodawaniu i filtrowaniu zapasów.
                  </p>
                  <div className="input-with-button" style={{ marginTop: '0.5rem' }}>
                    <label htmlFor={`${titleId}-new-cat`} className="visually-hidden">
                      Nowa kategoria
                    </label>
                    <input
                      type="text"
                      id={`${titleId}-new-cat`}
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCategory();
                        }
                      }}
                      placeholder="Nowa kategoria, np. Wypieki..."
                    />
                    <button type="button" className="btn-primary btn-sm" onClick={addCategory}>
                      Dodaj
                    </button>
                  </div>

                  <ul className="taxonomy-list">
                    {categories.map((cat, idx) => (
                      <li key={cat} className="taxonomy-item">
                        <span className="taxonomy-name">{cat}</span>
                        <div className="taxonomy-actions">
                          <button
                            type="button"
                            className="chip-btn"
                            disabled={idx === 0}
                            onClick={() => moveCategory(idx, -1)}
                            aria-label={`Przesuń ${cat} wyżej`}
                          >
                            Góra
                          </button>
                          <button
                            type="button"
                            className="chip-btn"
                            disabled={idx === categories.length - 1}
                            onClick={() => moveCategory(idx, 1)}
                            aria-label={`Przesuń ${cat} niżej`}
                          >
                            Dół
                          </button>
                          <button
                            type="button"
                            className="chip-btn btn-card-delete"
                            disabled={categories.length <= 1}
                            onClick={() => removeCategory(cat)}
                            aria-label={`Usuń kategorię ${cat}`}
                          >
                            Usuń
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="activity-history-section">
                <div className="activity-list">
                  {activity.length === 0 ? (
                    <span className="hint-text">Brak wpisów w historii.</span>
                  ) : (
                    activity.map((row) => {
                      const canRestore =
                        (row.action === 'consumed' || row.action === 'deleted') &&
                        row.details &&
                        Boolean(row.details.snapshot);
                      return (
                        <div key={row.id} className="activity-row">
                          <div className="activity-info">
                            <strong>{actionLabels[row.action] || row.action}</strong>
                            <span>
                              <code>{row.serial_number}</code> — {row.item_name}
                            </span>
                          </div>
                          <div className="activity-row-buttons">
                            {row.serial_number && (
                              <button
                                type="button"
                                className="chip-btn"
                                onClick={() => onReprintSerial(row.serial_number, row.item_name)}
                              >
                                Dodrukuj etykietę
                              </button>
                            )}
                            {canRestore && (
                              <button
                                type="button"
                                className="chip-btn"
                                onClick={() => onRestoreActivity(row.id)}
                              >
                                Przywróć
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="dialog-bottom-tabs">
          <div className="segmented-control" role="tablist" aria-label="Sekcje ustawień">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'general'}
              className={`seg-btn ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              Ogólne
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'taxonomy'}
              className={`seg-btn ${activeTab === 'taxonomy' ? 'active' : ''}`}
              onClick={() => setActiveTab('taxonomy')}
            >
              Lokalizacje i kategorie
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'history'}
              className={`seg-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Historia ({activity.length})
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

