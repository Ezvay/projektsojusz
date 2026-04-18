# ⚔ Projekt Sojusz — Metin2 Projekt Hard

Platforma koordynacji sojuszu gildi. Grota Wygnańców z globalną mapą.

## Stack
- **Backend**: Node.js + Express + Socket.io
- **Baza danych**: plik JSON na dysku serwera (zero konfiguracji!)
- **Hosting**: Render.com

---

## 🚀 Wdrożenie — tylko 2 kroki!

### 1. Wrzuć na GitHub

Rozpakuj ZIP, wejdź do folderu i wykonaj:

```bash
git init
git add .
git commit -m "Projekt Sojusz"
git remote add origin https://github.com/TWOJ_NICK/projekt-sojusz.git
git push -u origin main
```

### 2. Deploy na Render.com

1. Zaloguj się na [render.com](https://render.com)
2. **New → Web Service** → połącz GitHub → wybierz repo
3. Render automatycznie wykryje `render.yaml`
4. Kliknij **Deploy** — gotowe po ~2 minutach!

> ⚠️ **Ważne**: `render.yaml` zawiera konfigurację dysku (Disk).
> Render może poprosić o potwierdzenie — zaakceptuj.
> Dysk 1GB jest **darmowy** na płatnym planie ($7/mies).
> Na darmowym planie dane resetują się przy każdym deployu — wtedy
> użyj [Railway.app](https://railway.app) (instrukcja poniżej).

---

## 🚂 Alternatywa: Railway.app (w 100% darmowe z persistent storage)

1. Wejdź na [railway.app](https://railway.app) → zaloguj przez GitHub
2. **New Project → Deploy from GitHub repo** → wybierz repo
3. Railway automatycznie wykrywa Node.js i deployuje
4. Dane zapisują się na dysku i **przeżywają restarty**
5. Darmowy plan: 500h/miesiąc (wystarczy na ciągłe działanie)

---

## 📁 Struktura

```
projekt-sojusz/
├── server.js        # Backend (Express + Socket.io + zapis do pliku)
├── package.json
├── render.yaml
├── data/            # Tu zapisuje się state.json (tworzony automatycznie)
└── public/
    ├── index.html   # Strona główna
    ├── grota.html   # Grota Wygnańców
    ├── logo.png
    ├── grota_mapa.png
    ├── metin_icon.png
    └── reset.mp3
```

## 🎮 Funkcje Groty Wygnańców

- **Pingowanie metinów** — kliknij mapę → wybierz kanał CH1–CH8
- **Oznaczanie generałów** — tryb Generał → kliknij mapę → respawn 6–8h
- **Globalne timery** — Socket.io, zmiany widoczne u wszystkich natychmiast
- **Historia zbitych** — liczniki dostępnych metinów per kanał (timer 20–30min)
- **Heatmapa** — gdzie najczęściej są metiny
- **Snapshoty** — zapis stanu mapy
- **Reset** — selektywne czyszczenie
