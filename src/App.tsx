import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ViewName,
  InventoryItem,
  StatsResponse,
  AppSettings,
  ActivityEntry,
  CatalogProduct,
  LabelStickerItem,
} from './types';
import {
  IconBox,
  IconClock,
  IconQr,
  IconPlus,
  IconPrinter,
  IconSettings,
  IconSearch,
} from './icons';
import { scanVideoFrame, scanStaticImage } from './utils/ean13Decoder';
import { getExpiryBadgeInfo } from './utils/dialogLightDismiss';
import { ItemModal } from './components/ItemModal';
import { ReprintModal } from './components/ReprintModal';
import { SettingsModal } from './components/SettingsModal';
import { LabelsPreviewModal } from './components/LabelsPreviewModal';

const DEFAULT_LOCATIONS = ['Lodówka', 'Zamrażarka', 'Spiżarnia', 'Szafka', 'Piwnica'];
const DEFAULT_CATEGORIES = [
  'Nabiał',
  'Mięso i wędliny',
  'Warzywa i owoce',
  'Pieczywo',
  'Sypkie i makarony',
  'Konserwy i słoiki',
  'Napoje',
  'Mrożonki',
  'Przyprawy i sosy',
  'Przekąski i słodycze',
  'Inne',
];

const VIEW_META: Record<ViewName, { title: string; subtitle: string }> = {
  inventory: { title: 'Zapasy', subtitle: 'Wszystkie produkty w kuchni' },
  expiring: { title: 'Wkrótce wygasną', subtitle: 'Kontrola terminów ważności' },
  scanner: { title: 'Skaner QR i EAN', subtitle: 'Skanuj etykietę AAA-1111 lub kod kreskowy' },
  add: { title: 'Dodaj produkt', subtitle: 'Nowa pozycja i wydruk etykiety QR' },
};

export function App() {
  const [currentView, setCurrentView] = useState<ViewName>('inventory');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<InventoryItem[]>([]);
  const [expiringDays, setExpiringDays] = useState<number>(7);
  const [stats, setStats] = useState<StatsResponse>({
    total_items: 0,
    expired_count: 0,
    expiring_3d_count: 0,
    expiring_7d_count: 0,
    attention_count: 0,
    opened_count: 0,
    warning_days: 7,
    next_serial: 'AAA-0001',
    today: '',
    locations: DEFAULT_LOCATIONS,
    categories: DEFAULT_CATEGORIES,
    by_location: {},
    by_category: {},
  });

  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);

  const [settings, setSettings] = useState<AppSettings>({
    serial_seq: '0',
    printer_api_url: 'http://10.10.20.2:8769/print',
    printer_auto_print: 'true',
    printer_qr_mode: 'serial',
    printer_qr_base_url: '',
    expiry_warning_days: '7',
    locations: DEFAULT_LOCATIONS,
    categories: DEFAULT_CATEGORIES,
  });

  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [catalogSuggestions, setCatalogSuggestions] = useState<CatalogProduct[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState('expiry_asc');

  // Add Form State
  const [eanInput, setEanInput] = useState('');
  const [eanFeedback, setEanFeedback] = useState<{ text: string; tone: 'success' | 'warning' } | null>(null);
  const [addName, setAddName] = useState('');
  const [addBrand, setAddBrand] = useState('');
  const [addCategory, setAddCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [addLocation, setAddLocation] = useState(DEFAULT_LOCATIONS[0]);
  const [addQuantity, setAddQuantity] = useState('1');
  const [addUnit, setAddUnit] = useState('szt.');
  const [addExpiryDate, setAddExpiryDate] = useState('');
  const [addLabelsCount, setAddLabelsCount] = useState('1');
  const [addNotes, setAddNotes] = useState('');
  const [addAutoPrint, setAddAutoPrint] = useState(true);
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Modals
  const [activeItem, setActiveItem] = useState<InventoryItem | null>(null);
  const [activeItemQrSvg, setActiveItemQrSvg] = useState<string>('');
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintInitialSerials, setReprintInitialSerials] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<LabelStickerItem[]>([]);
  const [previewSummaryText, setPreviewSummaryText] = useState<string>('');

  // Scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStatusText, setCameraStatusText] = useState('Kamera wyłączona');
  const [manualScanCode, setManualScanCode] = useState('');
  const [eanScannerTarget, setEanScannerTarget] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const eanPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Toast state
  const [toast, setToast] = useState<{
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (message: string, actionLabel?: string, onAction?: () => void) => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      setToast({ message, actionLabel, onAction });
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 4500);
    },
    []
  );

  // Sync iOS Safari theme-color meta tags & root background so color bleeds onto top/bottom bars
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const syncThemeColor = () => {
      const color = mq.matches ? '#000000' : '#f2f2f7';
      document.documentElement.style.backgroundColor = color;
      document.body.style.backgroundColor = color;
    };
    syncThemeColor();
    mq.addEventListener('change', syncThemeColor);
    return () => mq.removeEventListener('change', syncThemeColor);
  }, []);

  const fetchStatsAndSettings = useCallback(async () => {
    try {
      const [statsRes, settingsRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/settings'),
      ]);
      if (statsRes.ok) {
        const data: StatsResponse = await statsRes.json();
        setStats(data);
        if (Array.isArray(data.locations) && data.locations.length > 0) {
          setLocations(data.locations);
        }
        if (Array.isArray(data.categories) && data.categories.length > 0) {
          setCategories(data.categories);
        }
      }
      if (settingsRes.ok) {
        const sJson = await settingsRes.json();
        const sData: AppSettings = sJson.settings || sJson;
        setSettings(sData);
        setAddAutoPrint(sData.printer_auto_print !== 'false');
        if (Array.isArray(sData.locations) && sData.locations.length > 0) {
          setLocations(sData.locations);
        }
        if (Array.isArray(sData.categories) && sData.categories.length > 0) {
          setCategories(sData.categories);
        }
      }
    } catch {
      // ignore network error on initial load
    }
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (filterLocation) params.set('location', filterLocation);
      if (filterCategory) params.set('category', filterCategory);
      if (filterStatus && filterStatus !== 'all') params.set('status', filterStatus);
      if (sortBy) params.set('sort', sortBy);

      const res = await fetch(`/api/items?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch {
      // ignore
    }
  }, [searchQuery, filterLocation, filterCategory, filterStatus, sortBy]);

  const fetchExpiringItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/items?status=expiring&days=${expiringDays}&sort=expiry_asc`);
      if (res.ok) {
        const data = await res.json();
        setExpiringItems(data.items || []);
      }
    } catch {
      // ignore
    }
  }, [expiringDays]);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/activity');
      if (res.ok) {
        const data = await res.json();
        setActivityLog(data.activity || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchStatsAndSettings();
    fetchItems();
    fetchExpiringItems();
  }, [fetchStatsAndSettings, fetchItems, fetchExpiringItems]);

  useEffect(() => {
    fetchStatsAndSettings();
    fetch('/api/catalog')
      .then((r) => r.json())
      .then((d) => setCatalogSuggestions((d.items || []).slice(0, 6)))
      .catch(() => {});

    // Check if URL path is /AAA-1111
    const match = window.location.pathname.match(/^\/([A-Za-z]{3}-\d{4})$/);
    if (match) {
      openItemBySerial(match[1].toUpperCase());
    }
  }, [fetchStatsAndSettings]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    fetchExpiringItems();
  }, [fetchExpiringItems]);

  // Keep addLocation and addCategory valid when locations/categories change
  useEffect(() => {
    if (locations.length > 0 && !locations.includes(addLocation)) {
      setAddLocation(locations[0]);
    }
  }, [locations, addLocation]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(addCategory)) {
      setAddCategory(categories[0]);
    }
  }, [categories, addCategory]);

  // Open an item modal and load its QR SVG
  const openItemModal = useCallback(async (item: InventoryItem) => {
    setActiveItem(item);
    if (item.qr_svg) {
      setActiveItemQrSvg(item.qr_svg);
    } else {
      try {
        const res = await fetch(`/api/qr/${encodeURIComponent(item.serial_number)}`);
        if (res.ok) {
          const data = await res.json();
          setActiveItemQrSvg(data.qr_svg || '');
        }
      } catch {
        setActiveItemQrSvg('');
      }
    }
  }, []);

  const openItemBySerial = useCallback(
    async (serial: string) => {
      try {
        const res = await fetch(`/api/items/by-serial/${encodeURIComponent(serial)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.found && data.item) {
            setActiveItem(data.item);
            setActiveItemQrSvg(data.qr_svg || '');
            showToast(`Zeskanowano etykietę ${serial}`);
            return;
          }
        }
        showToast(`Produkt o numerze ${serial} nie znajduje się w magazynie.`);
      } catch {
        showToast('Błąd wyszukiwania numeru seryjnego');
      }
    },
    [showToast]
  );

  // Stop camera when leaving scanner view
  const stopCamera = useCallback(() => {
    if (scanLoopRef.current) {
      window.cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraStatusText('Kamera wyłączona');
  }, []);

  // Polish EAN lookup
  const lookupEanCode = useCallback(
    async (codeToLookup?: string) => {
      const code = (codeToLookup ?? eanInput).trim();
      if (!code) {
        setEanFeedback({ text: 'Wpisz lub zeskanuj kod EAN.', tone: 'warning' });
        return;
      }
      setEanFeedback({ text: 'Szukam w polskiej bazie EAN...', tone: 'success' });
      try {
        const res = await fetch(`/api/ean/${encodeURIComponent(code)}`);
        if (!res.ok) {
          setEanFeedback({
            text: 'Nie znaleziono w bazie EAN — uzupełnij dane ręcznie, zostaną zapamiętane.',
            tone: 'warning',
          });
          return;
        }
        const data = await res.json();
        if (data.found && data.product) {
          const p = data.product;
          setAddName(p.name || '');
          setAddBrand(p.brand || '');
          if (p.category && categories.includes(p.category)) {
            setAddCategory(p.category);
          }
          if (p.default_location && locations.includes(p.default_location)) {
            setAddLocation(p.default_location);
          }
          if (p.default_unit || p.unit) setAddUnit(p.default_unit || p.unit);
          if (p.default_quantity || p.quantity_value) {
            setAddQuantity(String(p.default_quantity || p.quantity_value));
          }
          const shelfDays = p.default_shelf_life_days || p.default_shelf_days;
          if (shelfDays) {
            const d = new Date();
            d.setDate(d.getDate() + Number(shelfDays));
            setAddExpiryDate(d.toISOString().slice(0, 10));
          }
          const sourceLabel =
            data.source === 'local_catalog' ? 'Polski katalog lokalny' : 'Open Food Facts PL';
          setEanFeedback({
            text: `Znaleziono (${sourceLabel}): ${p.name}${p.brand ? ' — ' + p.brand : ''}`,
            tone: 'success',
          });
        } else {
          setEanFeedback({
            text: 'Produkt nieznany w bazie EAN — wpisz nazwę poniżej, a zostanie zapisany w katalogu.',
            tone: 'warning',
          });
        }
      } catch {
        setEanFeedback({ text: 'Błąd połączenia z bazą EAN.', tone: 'warning' });
      }
    },
    [eanInput, categories, locations]
  );

  // Handle scanned or typed code (Serial AAA-1111, short serial 1..9999, or EAN)
  const handleCodeDetected = useCallback(
    async (rawInput: string, forAddFormOnly = false) => {
      const cleaned = rawInput.trim();
      if (!cleaned) return;

      // 1. Extract AAA-1111 (or AAA-1) even if embedded in a URL
      const serialMatch = cleaned.toUpperCase().match(/([A-Z]{3})-?(\d{1,4})\b/);
      if (serialMatch && !forAddFormOnly) {
        const normalizedSerial = `${serialMatch[1]}-${serialMatch[2].padStart(4, '0')}`;
        await openItemBySerial(normalizedSerial);
        return;
      }

      // 2. Short numeric serial suffix (e.g. "1" -> "AAA-0001")
      if (/^\d{1,4}$/.test(cleaned) && !forAddFormOnly) {
        const numVal = parseInt(cleaned, 10);
        if (numVal >= 1 && numVal <= 9999) {
          const normalizedSerial = `AAA-${String(numVal).padStart(4, '0')}`;
          await openItemBySerial(normalizedSerial);
          return;
        }
      }

      // 3. Check if EAN barcode (8 to 14 digits)
      const digitsOnly = cleaned.replace(/\D/g, '');
      if (digitsOnly.length >= 8 && digitsOnly.length <= 14) {
        setCurrentView('add');
        setEanInput(digitsOnly);
        await lookupEanCode(digitsOnly);
        return;
      }

      showToast(`Nie rozpoznano kodu: ${cleaned}`);
    },
    [openItemBySerial, lookupEanCode, showToast]
  );

  // Keyboard-wedge hardware barcode scanner listener
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastKeyTime > 80) {
        buffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter' && buffer.length >= 4) {
        e.preventDefault();
        const code = buffer;
        buffer = '';
        handleCodeDetected(code);
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCodeDetected]);

  // Start live camera scanner
  const startCamera = useCallback(
    async (forEanInAdd = false) => {
      setEanScannerTarget(forEanInAdd);
      if (forEanInAdd) {
        setCurrentView('scanner');
      }

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        setCameraStatusText(
          'Przeglądarka wymaga HTTPS dla kamery na żywo. Użyj przycisku "Zrób zdjęcie kodu" poniżej (działa po HTTP na iOS).'
        );
        return;
      }

      stopCamera();
      setCameraStatusText('Uruchamianie kamery...');

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;

        // Wait up to 150ms if scanner view is just mounting
        let attempts = 0;
        while (!videoRef.current && attempts < 10) {
          await new Promise((r) => setTimeout(r, 20));
          attempts++;
        }

        const videoEl = videoRef.current;
        if (!videoEl) {
          stopCamera();
          return;
        }

        videoEl.srcObject = stream;
        videoEl.setAttribute('playsinline', 'true');
        videoEl.muted = true;
        await videoEl.play().catch(() => {});

        setCameraActive(true);
        setCameraStatusText('Skieruj kamerę na kod QR (AAA-1111) lub kod EAN...');

        const offscreen = document.createElement('canvas');
        let busy = false;

        const tick = () => {
          const video = videoRef.current;
          if (!video || !streamRef.current) return;

          if (!busy && video.readyState >= 2 && video.videoWidth > 0) {
            busy = true;
            scanVideoFrame(video, offscreen)
              .then((detected) => {
                busy = false;
                if (detected && streamRef.current) {
                  stopCamera();
                  handleCodeDetected(detected, forEanInAdd);
                }
              })
              .catch(() => {
                busy = false;
              });
          }
          if (streamRef.current) {
            scanLoopRef.current = window.requestAnimationFrame(tick);
          }
        };

        scanLoopRef.current = window.requestAnimationFrame(tick);
      } catch {
        setCameraStatusText(
          'Brak dostępu do kamery na żywo. Użyj przycisku "Zrób zdjęcie kodu" (działa na iOS przez HTTP).'
        );
      }
    },
    [stopCamera, handleCodeDetected]
  );

  // Auto-start camera when entering scanner view, stop when leaving
  useEffect(() => {
    if (currentView === 'scanner') {
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
        startCamera(eanScannerTarget);
      } else {
        setCameraStatusText(
          'Na połączeniu HTTP (iOS Safari) kliknij "Zrób zdjęcie kodu", aby użyć aparatu.'
        );
      }
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [currentView, eanScannerTarget, startCamera, stopCamera]);

  // Decode from photo file (iOS HTTP fallback & high-res photo decoder)
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>, forAddFormOnly = false) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    showToast('Analizuję zdjęcie kodu...');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      try {
        const detected = await scanStaticImage(img);
        URL.revokeObjectURL(url);
        if (detected) {
          await handleCodeDetected(detected, forAddFormOnly);
          return;
        }
        showToast(
          'Nie udało się odczytać kodu ze zdjęcia. Zbliż aparat do kodu lub wpisz go ręcznie.'
        );
      } catch {
        URL.revokeObjectURL(url);
        showToast('Błąd odczytu zdjęcia kodu.');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast('Nie udało się wczytać pliku zdjęcia.');
    };
    img.src = url;
  };

  const applyQuickExpiryDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setAddExpiryDate(d.toISOString().slice(0, 10));
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    setSubmittingAdd(true);
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim(),
          brand: addBrand.trim(),
          ean: eanInput.trim() || '',
          category: addCategory,
          location: addLocation,
          quantity: Number(addQuantity) || 1,
          unit: addUnit.trim() || 'szt.',
          expiry_date: addExpiryDate || null,
          batch_count: Math.max(1, Math.min(50, Number(addLabelsCount) || 1)),
          notes: addNotes.trim(),
          auto_print: addAutoPrint,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Nie udało się dodać produktu');
        return;
      }

      const created: InventoryItem[] = data.items || [];
      const serials = created.map((c) => c.serial_number).join(', ');
      const printedOk = (data.print_results || []).some((p: { ok?: boolean }) => p && p.ok);

      showToast(
        printedOk
          ? `Dodano i wydrukowano: ${serials}`
          : `Dodano: ${serials} (podgląd etykiety gotowy)`
      );

      // Reset form
      setAddName('');
      setAddBrand('');
      setEanInput('');
      setEanFeedback(null);
      setAddQuantity('1');
      setAddUnit('szt.');
      setAddExpiryDate('');
      setAddLabelsCount('1');
      setAddNotes('');

      refreshAll();
      if (created.length > 0) {
        const stickers: LabelStickerItem[] = created.map((c) => ({
          serial_number: c.serial_number,
          name: c.name,
          qr_svg: c.qr_svg || '',
        }));
        setPreviewSummaryText(`Wygenerowano etykiety dla: ${serials}`);
        setPreviewItems(stickers);
      }
    } catch {
      showToast('Błąd zapisu produktu');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleRestoreActivity = async (activityId: number) => {
    try {
      const res = await fetch(`/api/activity/${activityId}/restore`, { method: 'POST' });
      if (res.ok) {
        showToast('Przywrócono usunięty produkt do zapasów');
        refreshAll();
        fetchActivity();
      } else {
        showToast('Nie udało się przywrócić produktu');
      }
    } catch {
      showToast('Błąd przywracania produktu');
    }
  };

  // ItemModal callbacks
  const handleConsumeAll = async (serial: string) => {
    try {
      const res = await fetch(`/api/items/by-serial/${encodeURIComponent(serial)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        setActiveItem(null);
        refreshAll();
        if (data.activity_id) {
          showToast(data.message || `Usunięto ${serial}`, 'Cofnij', () => {
            handleRestoreActivity(data.activity_id);
          });
        } else {
          showToast(data.message || `Usunięto ${serial}`);
        }
      } else {
        showToast(data.error || 'Błąd usuwania produktu');
      }
    } catch {
      showToast('Błąd połączenia z serwerem');
    }
  };

  const handleMarkOpened = async (id: number) => {
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open' }),
      });
      const data = await res.json();
      if (res.ok && data.item) {
        setActiveItem(data.item);
        refreshAll();
        showToast('Oznaczono produkt jako otwarty');
      }
    } catch {
      showToast('Błąd aktualizacji produktu');
    }
  };

  const handleConsumePartial = async (id: number, opts: { fraction?: number; delta?: number }) => {
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'consume_partial', ...opts }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.deleted) {
          setActiveItem(null);
          refreshAll();
          if (data.activity_id) {
            showToast(data.message || 'Zużyto produkt w całości', 'Cofnij', () => {
              handleRestoreActivity(data.activity_id);
            });
          } else {
            showToast(data.message || 'Zużyto produkt w całości');
          }
        } else if (data.item) {
          setActiveItem(data.item);
          refreshAll();
          showToast(`Zaktualizowano ilość: ${data.item.quantity} ${data.item.unit}`);
        }
      }
    } catch {
      showToast('Błąd aktualizacji ilości');
    }
  };

  const handleMoveLocation = async (id: number, newLocation: string) => {
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: newLocation }),
      });
      const data = await res.json();
      if (res.ok && data.item) {
        setActiveItem(data.item);
        refreshAll();
        showToast(`Przeniesiono do: ${newLocation}`);
      }
    } catch {
      showToast('Błąd zmiany lokalizacji');
    }
  };

  const handleUpdateItem = async (
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
  ) => {
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.item) {
        setActiveItem(data.item);
        refreshAll();
        showToast('Zapisano zmiany produktu');
      }
    } catch {
      showToast('Błąd zapisu zmian');
    }
  };

  const handleReprintSingle = async (serial: string, copies = 1) => {
    try {
      const res = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial_number: serial, copies }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Wysłano dodruk etykiety ${serial} (${copies}x)`);
      } else {
        showToast(
          `Drukarka niedostępna (${serial}) — otwieram podgląd do druku w przeglądarce`
        );
        if (data.qr_svg) {
          setPreviewSummaryText(`Podgląd etykiety ${serial}`);
          setPreviewItems([
            {
              serial_number: serial,
              name: data.item_name || serial,
              qr_svg: data.qr_svg,
            },
          ]);
        }
      }
    } catch {
      showToast('Błąd połączenia z drukarką');
    }
  };

  const handleExecuteBatchReprint = async (opts: {
    serialNumbers?: string | string[];
    fromSerial?: string;
    toSerial?: string;
    copies: number;
    previewOnly: boolean;
  }) => {
    try {
      const res = await fetch('/api/print/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_numbers: opts.serialNumbers,
          from_serial: opts.fromSerial,
          to_serial: opts.toSerial,
          copies: opts.copies,
          preview_only: opts.previewOnly,
        }),
      });
      const data = await res.json();
      if (!res.ok && !data.labels) {
        showToast(data.error || 'Błąd przygotowania dodruku etykiet');
        return;
      }

      setReprintOpen(false);
      if (opts.previewOnly || !data.ok) {
        setPreviewSummaryText(
          opts.previewOnly
            ? `Przygotowano ${data.total_labels || 0} etykiet do wydruku.`
            : `Drukarka sieciowa niedostępna — przygotowano podgląd ${data.total_labels || 0} etykiet.`
        );
        setPreviewItems(data.labels || []);
      } else {
        showToast(`Wydrukowano serię etykiet (${data.printed_count} szt.)`);
      }
    } catch {
      showToast('Błąd wykonania dodruku seryjnego');
    }
  };

  const handleSaveSettings = async (patch: Partial<AppSettings>) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        const updated: AppSettings = data.settings;
        setSettings(updated);
        if (Array.isArray(updated.locations) && updated.locations.length > 0) {
          setLocations(updated.locations);
        }
        if (Array.isArray(updated.categories) && updated.categories.length > 0) {
          setCategories(updated.categories);
        }
        setAddAutoPrint(updated.printer_auto_print !== 'false');
        refreshAll();
        showToast('Zapisano ustawienia');
      } else {
        showToast('Nie udało się zapisać ustawień');
      }
    } catch {
      showToast('Błąd zapisu ustawień');
    }
  };

  const handleTestPrinter = async (printerConfig: Partial<AppSettings>) => {
    await handleSaveSettings(printerConfig);
    await handleReprintSingle('AAA-0001', 1);
  };

  const expiringBadgeCount = stats.attention_count || 0;

  const renderItemCard = (item: InventoryItem) => {
    const badge = getExpiryBadgeInfo(item);
    return (
      <article
        key={item.id}
        className={`item-card status-${item.expiry_status}`}
        onClick={() => openItemModal(item)}
      >
        <div className="item-card-top">
          <div className="item-card-title-group">
            <h3 className="item-card-name">{item.name}</h3>
            {item.brand && <div className="item-card-brand">{item.brand}</div>}
          </div>
          <span className="serial-chip">{item.serial_number}</span>
        </div>

        <div className="item-card-bottom">
          <div className="item-meta-pills">
            <span className="meta-tag">{item.location}</span>
            <span className="meta-tag">{item.category}</span>
            <span className="meta-tag qty">
              {item.quantity} {item.unit}
            </span>
            {item.is_opened && <span className="meta-tag opened">Otwarte</span>}
          </div>
          <span className={`expiry-pill ${badge.cls}`}>
            <span aria-hidden="true">{badge.marker}</span>
            <span>{badge.text}</span>
          </span>
        </div>
      </article>
    );
  };

  return (
    <div className="app-shell">
      {/* Desktop / Tablet Sidebar */}
      <aside className="sidebar" aria-label="Nawigacja główna">
        <div>
          <div className="brand">
            <div className="brand-icon" aria-hidden="true">
              <IconBox />
            </div>
            <div>
              <div className="brand-title">Spiżarnia</div>
              <div className="brand-subtitle">Magazyn Kuchenny WMS</div>
            </div>
          </div>

          <nav className="sidebar-nav">
            <button
              type="button"
              className={`nav-item ${currentView === 'inventory' ? 'active' : ''}`}
              onClick={() => setCurrentView('inventory')}
            >
              <IconBox />
              <span>Zapasy</span>
            </button>

            <button
              type="button"
              className={`nav-item ${currentView === 'expiring' ? 'active' : ''}`}
              onClick={() => setCurrentView('expiring')}
            >
              <IconClock />
              <span>Wkrótce wygasną</span>
              {expiringBadgeCount > 0 && <span className="nav-badge">{expiringBadgeCount}</span>}
            </button>

            <button
              type="button"
              className={`nav-item ${currentView === 'scanner' ? 'active' : ''}`}
              onClick={() => setCurrentView('scanner')}
            >
              <IconQr />
              <span>Skaner QR / EAN</span>
            </button>

            <button
              type="button"
              className={`nav-item ${currentView === 'add' ? 'active' : ''}`}
              onClick={() => setCurrentView('add')}
            >
              <IconPlus />
              <span>Dodaj i drukuj</span>
            </button>
          </nav>
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-settings-btn"
            onClick={() => {
              setReprintInitialSerials([]);
              setReprintOpen(true);
            }}
          >
            <IconPrinter />
            <span>Dodruk etykiet</span>
          </button>

          <button
            type="button"
            className="sidebar-settings-btn"
            onClick={() => {
              fetchActivity();
              setSettingsOpen(true);
            }}
          >
            <IconSettings />
            <span>Ustawienia i słowniki</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="main-column">
        {/* Sticky Top Bar (Fixed height, bleeds into iOS status bar) */}
        <header className="topbar">
          <div className="topbar-inner">
            <div className="topbar-title-wrap">
              <h1 className="topbar-title">{VIEW_META[currentView].title}</h1>
            </div>
            <div className="topbar-actions">
              <button
                type="button"
                className="icon-btn"
                title="Dodruk etykiet QR (pojedynczo lub seryjnie)"
                onClick={() => {
                  setReprintInitialSerials([]);
                  setReprintOpen(true);
                }}
              >
                <IconPrinter />
                <span className="icon-btn-label">Dodruk</span>
              </button>

              <button
                type="button"
                className="icon-btn"
                title="Ustawienia, lokalizacje, kategorie i drukarka"
                onClick={() => {
                  fetchActivity();
                  setSettingsOpen(true);
                }}
              >
                <IconSettings />
                <span className="icon-btn-label">Ustawienia</span>
              </button>
            </div>
          </div>
        </header>

        <main className="main-content">
          {/* VIEW 1: INVENTORY */}
          {currentView === 'inventory' && (
            <section className="view-panel">
              <div className="summary-strip">
                <button
                  type="button"
                  className={`summary-card ${filterStatus === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterStatus('all')}
                >
                  <span className="summary-label">Wszystkie</span>
                  <span className="summary-value">{stats.total_items}</span>
                </button>

                <button
                  type="button"
                  className={`summary-card warning ${
                    filterStatus === 'soon_only' ? 'active' : ''
                  }`}
                  onClick={() =>
                    setFilterStatus(filterStatus === 'soon_only' ? 'all' : 'soon_only')
                  }
                >
                  <span className="summary-label">Wygasa ({stats.warning_days} dni)</span>
                  <span className="summary-value">{stats.expiring_7d_count}</span>
                </button>

                <button
                  type="button"
                  className={`summary-card danger ${filterStatus === 'expired' ? 'active' : ''}`}
                  onClick={() => setFilterStatus(filterStatus === 'expired' ? 'all' : 'expired')}
                >
                  <span className="summary-label">Po terminie</span>
                  <span className="summary-value">{stats.expired_count}</span>
                </button>

                <button
                  type="button"
                  className={`summary-card info ${filterStatus === 'opened' ? 'active' : ''}`}
                  onClick={() => setFilterStatus(filterStatus === 'opened' ? 'all' : 'opened')}
                >
                  <span className="summary-label">Otwarte</span>
                  <span className="summary-value">{stats.opened_count}</span>
                </button>
              </div>

              <search className="filter-bar">
                <div className="search-row">
                  <div className="search-box">
                    <label htmlFor="inventorySearchInput" className="visually-hidden">
                      Szukaj w zapasach
                    </label>
                    <span className="search-icon" aria-hidden="true">
                      <IconSearch />
                    </span>
                    <input
                      id="inventorySearchInput"
                      name="q"
                      type="search"
                      placeholder="Szukaj po nazwie, marce, numerze AAA-1111 lub EAN..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        className="clear-btn"
                        aria-label="Wyczyść wyszukiwanie"
                        onClick={() => setSearchQuery('')}
                      >
                        X
                      </button>
                    )}
                  </div>
                </div>

                <div className="filter-controls-row">
                  <div className="pill-scroll" role="tablist" aria-label="Filtr lokalizacji">
                    <button
                      type="button"
                      className={`pill ${filterLocation === '' ? 'active' : ''}`}
                      onClick={() => setFilterLocation('')}
                    >
                      Wszystkie miejsca
                    </button>
                    {locations.map((loc) => (
                      <button
                        key={loc}
                        type="button"
                        className={`pill ${filterLocation === loc ? 'active' : ''}`}
                        onClick={() => setFilterLocation(filterLocation === loc ? '' : loc)}
                      >
                        {loc}
                      </button>
                    ))}
                  </div>

                  <div className="filter-selects">
                    <select
                      className="compact-select"
                      aria-label="Filtr kategorii"
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                    >
                      <option value="">Wszystkie kategorie</option>
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>

                    <select
                      className="compact-select"
                      aria-label="Sortowanie"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                    >
                      <option value="expiry_asc">Termin ważności: od najbliższego</option>
                      <option value="created_desc">Ostatnio dodane</option>
                      <option value="name_asc">Alfabetycznie A–Z</option>
                      <option value="serial_asc">Numer seryjny AAA-1111</option>
                    </select>
                  </div>
                </div>
              </search>

              <div className="inventory-container">
                {items.length > 0 ? (
                  <div className="items-grid">{items.map(renderItemCard)}</div>
                ) : (
                  <div className="empty-state">
                    <h3>Brak produktów spełniających kryteria</h3>
                    <p>Dodaj nową pozycję do magazynu lub zmień filtry wyszukiwania.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* VIEW 2: EXPIRING SOON */}
          {currentView === 'expiring' && (
            <section className="view-panel">
              <div className="section-header">
                <div>
                  <h2>Produkty wymagające uwagi</h2>
                  <p>Posortowane od najpilniejszych do zużycia w kuchni</p>
                </div>
                <div className="window-selector" role="group" aria-label="Zakres dni">
                  {[3, 7, 14, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`pill ${expiringDays === d ? 'active' : ''}`}
                      onClick={() => setExpiringDays(d)}
                    >
                      Do {d} dni
                    </button>
                  ))}
                </div>
              </div>

              <div className="inventory-container">
                {expiringItems.length > 0 ? (
                  <div className="items-grid">{expiringItems.map(renderItemCard)}</div>
                ) : (
                  <div className="empty-state">
                    <h3>Wszystkie zapasy są świeże</h3>
                    <p>Brak produktów wygasających w wybranym przedziale czasowym.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* VIEW 3: QR & EAN SCANNER */}
          {currentView === 'scanner' && (
            <section className="view-panel">
              <div className="scanner-layout">
                <div className="scanner-card card">
                  <div className="scanner-header">
                    <h2>Skanuj etykietę QR lub kod EAN</h2>
                    <p className="muted-text">
                      Zeskanowanie kodu <strong>AAA-1111</strong> otwiera kartę produktu z szybkim
                      usunięciem, edycją lub dodrukiem. Zeskanowanie kodu <strong>EAN</strong>{' '}
                      wypełnia formularz dodawania.
                    </p>
                  </div>

                  <div className="camera-viewport">
                    <video ref={videoRef} playsInline muted />
                    <div className="scan-reticle" aria-hidden="true" />
                    {!cameraActive && (
                      <div className="camera-placeholder">
                        <p>{cameraStatusText}</p>
                      </div>
                    )}
                  </div>

                  <div className="scanner-controls">
                    {!cameraActive ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          if (
                            navigator.mediaDevices &&
                            typeof navigator.mediaDevices.getUserMedia === 'function'
                          ) {
                            startCamera(eanScannerTarget);
                          } else {
                            photoInputRef.current?.click();
                          }
                        }}
                      >
                        Uruchom kamerę na żywo
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary" onClick={stopCamera}>
                        Zatrzymaj kamerę
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => photoInputRef.current?.click()}
                    >
                      Zrób zdjęcie kodu (iOS HTTP)
                    </button>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{ display: 'none' }}
                      onChange={(e) => handlePhotoCapture(e, eanScannerTarget)}
                    />
                  </div>
                </div>

                <div className="manual-scan-card card">
                  <h3>Wpisz kod ręcznie lub użyj czytnika USB / Bluetooth</h3>
                  <p className="muted-text">
                    Wprowadź numer seryjny (np. <code>AAA-0001</code> lub <code>1</code>) albo kod
                    kreskowy EAN-13.
                  </p>
                  <form
                    className="manual-lookup-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCodeDetected(manualScanCode, eanScannerTarget);
                    }}
                  >
                    <input
                      type="text"
                      placeholder="np. AAA-0001, 1 lub 5900512300108"
                      value={manualScanCode}
                      onChange={(e) => setManualScanCode(e.target.value)}
                      autoCapitalize="characters"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <button type="submit" className="btn btn-primary">
                      Otwórz
                    </button>
                  </form>
                </div>
              </div>
            </section>
          )}

          {/* VIEW 4: ADD ITEM */}
          {currentView === 'add' && (
            <section className="view-panel">
              <form className="card form-card" onSubmit={handleAddSubmit}>
                <div className="section-header">
                  <div>
                    <h2>Nowa pozycja magazynowa</h2>
                    <p>
                      Kolejny numer seryjny: <strong>{stats.next_serial}</strong>. Po zapisaniu
                      etykieta QR zostanie przygotowana do wydruku.
                    </p>
                  </div>
                </div>

                <div className="ean-lookup-banner">
                  <div className="form-field">
                    <label htmlFor="eanInputField">Kod kreskowy EAN (Polska baza produktów)</label>
                    <div className="ean-input-group">
                      <input
                        id="eanInputField"
                        type="text"
                        inputMode="numeric"
                        placeholder="np. 5900512300108"
                        value={eanInput}
                        onChange={(e) => setEanInput(e.target.value)}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => lookupEanCode()}
                      >
                        Pobierz dane EAN
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => {
                          if (
                            navigator.mediaDevices &&
                            typeof navigator.mediaDevices.getUserMedia === 'function'
                          ) {
                            startCamera(true);
                          } else {
                            eanPhotoInputRef.current?.click();
                          }
                        }}
                      >
                        Skanuj aparatem
                      </button>
                      <input
                        ref={eanPhotoInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: 'none' }}
                        onChange={(e) => handlePhotoCapture(e, true)}
                      />
                    </div>
                    {eanFeedback && (
                      <div className={`ean-feedback ${eanFeedback.tone}`}>{eanFeedback.text}</div>
                    )}
                  </div>

                  {catalogSuggestions.length > 0 && (
                    <div className="catalog-suggestions">
                      {catalogSuggestions.map((prod) => (
                        <button
                          key={prod.ean}
                          type="button"
                          className="suggestion-chip"
                          onClick={() => {
                            setEanInput(prod.ean);
                            lookupEanCode(prod.ean);
                          }}
                        >
                          {prod.name} ({prod.ean})
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="form-grid">
                  <div className="form-field full-width">
                    <label htmlFor="itemNameInput">Nazwa produktu *</label>
                    <input
                      id="itemNameInput"
                      type="text"
                      required
                      placeholder="np. Mleko UHT 3,2%"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      autoComplete="off"
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="itemBrandInput">Marka / Producent</label>
                    <input
                      id="itemBrandInput"
                      type="text"
                      placeholder="np. Mlekovita, Łowicz, Pudliszki"
                      value={addBrand}
                      onChange={(e) => setAddBrand(e.target.value)}
                      autoComplete="off"
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="itemCategorySelect">Kategoria</label>
                    <select
                      id="itemCategorySelect"
                      value={addCategory}
                      onChange={(e) => setAddCategory(e.target.value)}
                    >
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <fieldset className="form-field full-width">
                    <legend>Lokalizacja w kuchni</legend>
                    <div className="segmented-locations">
                      {locations.map((loc) => (
                        <label key={loc} className="seg-option">
                          <input
                            type="radio"
                            name="locationRadio"
                            value={loc}
                            checked={addLocation === loc}
                            onChange={() => setAddLocation(loc)}
                          />
                          <span>{loc}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="form-field">
                    <label htmlFor="itemQuantityInput">Ilość w opakowaniu</label>
                    <input
                      id="itemQuantityInput"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={addQuantity}
                      onChange={(e) => setAddQuantity(e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="itemUnitSelect">Jednostka</label>
                    <select
                      id="itemUnitSelect"
                      value={addUnit}
                      onChange={(e) => setAddUnit(e.target.value)}
                    >
                      <option value="szt.">szt. (sztuki)</option>
                      <option value="opak.">opak. (opakowanie)</option>
                      <option value="l">l (litry)</option>
                      <option value="ml">ml (mililitry)</option>
                      <option value="kg">kg (kilogramy)</option>
                      <option value="g">g (gramy)</option>
                      <option value="słoik">słoik</option>
                      <option value="puszka">puszka</option>
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="itemExpiryInput">Data ważności</label>
                    <input
                      id="itemExpiryInput"
                      type="date"
                      value={addExpiryDate}
                      onChange={(e) => setAddExpiryDate(e.target.value)}
                    />
                    <div className="date-Quick-row">
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => applyQuickExpiryDays(3)}
                      >
                        +3 dni
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => applyQuickExpiryDays(7)}
                      >
                        +7 dni
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => applyQuickExpiryDays(14)}
                      >
                        +14 dni
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => applyQuickExpiryDays(30)}
                      >
                        +1 mies.
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => applyQuickExpiryDays(180)}
                      >
                        +6 mies.
                      </button>
                    </div>
                  </div>

                  <div className="form-field">
                    <label htmlFor="labelsCountInput">Liczba sztuk (osobne numery AAA-1111)</label>
                    <input
                      id="labelsCountInput"
                      type="number"
                      min="1"
                      max="50"
                      value={addLabelsCount}
                      onChange={(e) => setAddLabelsCount(e.target.value)}
                    />
                  </div>

                  <div className="form-field full-width">
                    <label htmlFor="itemNotesInput">Notatka (opcjonalnie)</label>
                    <input
                      id="itemNotesInput"
                      type="text"
                      placeholder="np. Domowy przecier, otwarte 2 dni temu"
                      value={addNotes}
                      onChange={(e) => setAddNotes(e.target.value)}
                      autoComplete="off"
                    />
                  </div>

                  <div className="form-field full-width checkbox-row">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={addAutoPrint}
                        onChange={(e) => setAddAutoPrint(e.target.checked)}
                      />
                      <span>
                        Automatycznie wyślij etykietę QR do drukarki ({settings.printer_api_url})
                      </span>
                    </label>
                  </div>
                </div>

                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg"
                    disabled={submittingAdd}
                  >
                    {submittingAdd
                      ? 'Zapisywanie...'
                      : 'Dodaj do zapasów i generuj kod AAA-1111'}
                  </button>
                </div>
              </form>
            </section>
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar — Fixed 4 Equal Columns, Identical Icon Box & Font Metrics */}
      <nav className="bottom-tabbar" aria-label="Nawigacja mobilna">
        <button
          type="button"
          className={`tab-btn ${currentView === 'inventory' ? 'active' : ''}`}
          onClick={() => setCurrentView('inventory')}
        >
          <span className="tab-icon-box" aria-hidden="true">
            <IconBox />
          </span>
          <span className="tab-label">Zapasy</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${currentView === 'expiring' ? 'active' : ''}`}
          onClick={() => setCurrentView('expiring')}
        >
          <span className="tab-icon-box" aria-hidden="true">
            <IconClock />
            {expiringBadgeCount > 0 && (
              <span className="tab-badge">{expiringBadgeCount}</span>
            )}
          </span>
          <span className="tab-label">Wygasające</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${currentView === 'scanner' ? 'active' : ''}`}
          onClick={() => setCurrentView('scanner')}
        >
          <span className="tab-icon-box" aria-hidden="true">
            <IconQr />
          </span>
          <span className="tab-label">Skaner QR</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${currentView === 'add' ? 'active' : ''}`}
          onClick={() => setCurrentView('add')}
        >
          <span className="tab-icon-box" aria-hidden="true">
            <IconPlus />
          </span>
          <span className="tab-label">Dodaj</span>
        </button>
      </nav>

      {/* Modals */}
      <ItemModal
        isOpen={Boolean(activeItem)}
        onClose={() => setActiveItem(null)}
        item={activeItem}
        qrSvg={activeItemQrSvg}
        locations={locations}
        categories={categories}
        onConsumeAll={handleConsumeAll}
        onMarkOpened={handleMarkOpened}
        onConsumePartial={handleConsumePartial}
        onMoveLocation={handleMoveLocation}
        onUpdateItem={handleUpdateItem}
        onReprintApi={(serial, copies) => handleReprintSingle(serial, copies)}
        onBrowserPrint={(stickers) => {
          setActiveItem(null);
          setPreviewSummaryText('Podgląd wydruku etykiet');
          setPreviewItems(stickers);
        }}
      />

      <ReprintModal
        isOpen={reprintOpen}
        onClose={() => setReprintOpen(false)}
        allItems={items}
        initialSelectedSerials={reprintInitialSerials}
        onExecuteBatchReprint={handleExecuteBatchReprint}
        onReprintSingle={(serial, copies) => handleReprintSingle(serial, copies)}
      />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        activity={activityLog}
        onSaveSettings={handleSaveSettings}
        onTestPrinter={handleTestPrinter}
        onRestoreActivity={handleRestoreActivity}
        onReprintSerial={(serial) => handleReprintSingle(serial, 1)}
      />

      <LabelsPreviewModal
        isOpen={previewItems.length > 0}
        onClose={() => setPreviewItems([])}
        items={previewItems}
        summaryText={previewSummaryText}
        onReprintSingle={(serial) => handleReprintSingle(serial, 1)}
        onReprintAllApi={() => {
          const serials = previewItems.map((i) => i.serial_number);
          handleExecuteBatchReprint({
            serialNumbers: serials,
            copies: 1,
            previewOnly: false,
          });
        }}
        onBrowserPrint={() => window.print()}
      />

      {/* Toast Notification */}
      <div
        className={`toast-container ${toast ? '' : 'hidden'}`}
        role="status"
        aria-live="polite"
      >
        <span>{toast?.message}</span>
        {toast?.actionLabel && toast?.onAction && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              toast.onAction?.();
              setToast(null);
            }}
          >
            {toast.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
