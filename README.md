# Spiżarnia — Magazyn Kuchenny WMS

Aplikacja webowa (zbudowana w **Vite + React + TypeScript** na frontendzie oraz **Node.js 22 + SQLite** na backendzie) do zarządzania zapasami kuchennymi, terminami ważności (FEFO), generowania i drukowania etykiet z kodami QR (`AAA-1111`), skanowania kodów QR/EAN-13 oraz wyszukiwania produktów w polskiej bazie EAN.

Zaprojektowana zgodnie z **Apple Human Interface Guidelines** (iOS / iPadOS / macOS), z automatycznym trybem jasnym i ciemnym (`light-dark()` / `prefers-color-scheme`), rozszerzeniem koloru tła na paski systemowe iOS Safari (`theme-color` + `viewport-fit=cover`) oraz responsywnym układem mobile-first bez poziomego przewijania.

---

## Główne funkcje

1. **Baza danych SQLite z trwałym wolumenem Docker (`/data/kitchen.db`)**
   - Tryb `WAL` dla wysokiej wydajności i bezpieczeństwa danych.
   - Zapisuje stan magazynowy, konfigurowalne lokalizacje i kategorie, lokalny katalog polskich kodów EAN, licznik numerów seryjnych oraz historię operacji (z możliwością cofnięcia przypadkowego usunięcia).

2. **Konfigurowalne lokalizacje i kategorie**
   - W oknie **Ustawienia -> Lokalizacje i kategorie** użytkownik może dodawać nowe miejsca przechowywania (np. `Lodówka`, `Zamrażarka`, `Spiżarnia`, `Piwnica`), zmieniać ich kolejność oraz usuwać nieużywane pozycje.
   - Analogicznie można zarządzać listą kategorii produktów — zmiany są natychmiast widoczne we wszystkich filtrach, formularzach i oknach edycji.

3. **Automatyczne numery seryjne w formacie `AAA-1111`**
   - Sekwencyjna numeracja od `AAA-0001` do `AAA-9999`, następnie `AAB-0001` … aż do `ZZZ-9999`.
   - Obsługa dodawania pojedynczego oraz seryjnego (np. dodanie 5 sztuk mleka naraz generuje `AAA-0001`..`AAA-0005`).

4. **Automatyczny wydruk oraz dodruk etykiet QR (pojedynczy i seryjny) przez API drukarki**
   - Po dodaniu produktu aplikacja automatycznie wysyła żądanie HTTP `POST` do skonfigurowanego API drukarki (domyślnie `http://10.10.20.2:8769/print`):
     ```bash
     curl -X POST http://10.10.20.2:8769/print \
       -H "Content-Type: application/json" \
       -d '{
         "text": "AAA-0001",
         "qr_text": "AAA-0001"
       }'
     ```
   - **Dodruk pojedynczy**: W oknie szczegółów produktu (z wyborem liczby kopii), w oknie dodruku oraz w historii aktywności.
   - **Dodruk seryjny (Batch Reprint)**: Dedykowane okno **„Dodruk etykiet QR (pojedynczy i seryjny)”** pozwalające zaznaczyć dowolne pozycje z magazynu, podać zakres numerów seryjnych (`Od: AAA-0001` `Do: AAA-0010`) lub wkleić listę numerów oraz określić liczbę kopii na pozycję.

5. **Skaner kodów QR i EAN-13 (przystosowany również do czystego HTTP na iOS)**
   - **Kamera na żywo (`getUserMedia`)** — skanuje kody QR (`AAA-1111`) oraz kody kreskowe `EAN-13` / `EAN-8`.
   - **Tryb „Zrób zdjęcie kodu” (`capture="environment"`)** — otwiera natywny aparat iPhone’a bez wymogu HTTPS (działa po czystym `http://10.10.20.x:3000` w sieci lokalnej).
   - **Karta akcji po zeskanowaniu QR** — pozwala jednym dotknięciem usunąć zużyty produkt (z opcją „Cofnij”), oznaczyć opakowanie jako **Otwarte**, zużyć częściowo (`-25%`, `-50%`, `-1 jedn.`), przenieść między skonfigurowanymi lokalizacjami lub dodrukować etykietę.
   - **Wsparcie dla skanerów sprzętowych USB/Bluetooth** oraz szybkiego wpisywania kodu ręcznie.

6. **Polska baza kodów EAN (`pl.openfoodfacts.org` + lokalny katalog SQLite)**
   - Automatyczne pobieranie polskiej nazwy produktu, marki, gramatury/objętości, kategorii oraz sugerowanego miejsca przechowywania.
   - Wbudowany katalog najpopularniejszych polskich produktów (`590...`) działający również offline.

7. **Lista produktów wkrótce wygasających**
   - Zakładka **Wkrótce wygasną** z filtrowaniem przedziału dni (`3`, `7`, `14`, `30 dni`) oraz uwzględnieniem skróconego czasu przydatności po otwarciu opakowania.

---

## Uruchomienie w Dockerze (HTTP bez reverse proxy)

```bash
docker compose up -d --build
```

Aplikacja będzie dostępna pod adresem:
- **`http://localhost:3000`** (lub `http://<IP-SERWERA>:3000` w sieci lokalnej)

Dane SQLite są przechowywane w nazwanym wolumenie Docker `kitchen_wms_data` zamontowanym w `/data/kitchen.db`.

### Zmienne środowiskowe (`docker-compose.yml`)

| Zmienna | Domyślna wartość | Opis |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port HTTP serwera |
| `DB_PATH` | `/data/kitchen.db` | Ścieżka do pliku bazy SQLite |
| `PRINTER_API_URL` | `http://10.10.20.2:8769/print` | Domyślny adres endpointu drukarki etykiet |
| `TZ` | `Europe/Warsaw` | Strefa czasowa do obliczania dat ważności |

---

## Uruchomienie lokalne (Node.js 22+)

```bash
npm install
npm run build
npm start
# Testy automatyczne:
npm test
```
