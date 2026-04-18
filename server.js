# ⚔ Projekt Sojusz — Metin2 Projekt Hard

Platforma koordynacji sojuszu gildi. Na razie: **Grota Wygnańców** z globalną mapą.

## Stack
- **Backend**: Node.js + Express + Socket.io
- **Baza danych**: MongoDB Atlas (darmowy plan M0)
- **Hosting**: Render.com (darmowy plan)

---

## 🚀 Wdrożenie krok po kroku

### 1. MongoDB Atlas (baza danych)

1. Wejdź na [mongodb.com/atlas](https://www.mongodb.com/atlas) → **Try Free**
2. Utwórz organizację i projekt
3. Kliknij **Create a cluster** → wybierz **M0 Free**
4. W **Database Access**: Add user → login + hasło (zapamiętaj!)
5. W **Network Access**: Add IP → `0.0.0.0/0` (dostęp z każdego IP)
6. Kliknij **Connect** → **Drivers** → skopiuj connection string:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/sojusz?retryWrites=true&w=majority
   ```
7. Wklej go do `server.js` (linia `MONGO_URI`) **lub** ustaw jako zmienną środowiskową na Render.com

### 2. GitHub

```bash
git init
git add .
git commit -m "Initial commit - Projekt Sojusz"
git remote add origin https://github.com/TWOJ_NICK/projekt-sojusz.git
git push -u origin main
```

### 3. Render.com

1. Zaloguj się na [render.com](https://render.com)
2. **New → Web Service** → połącz z GitHub → wybierz repo
3. Ustawienia:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. W **Environment Variables** dodaj:
   - Key: `MONGO_URI`
   - Value: Twój connection string z MongoDB Atlas
5. Kliknij **Deploy** — po ~2 minutach strona działa!

---

## 📁 Struktura

```
projekt-sojusz/
├── server.js           # Backend (Express + Socket.io + MongoDB)
├── package.json
├── render.yaml
└── public/
    ├── index.html      # Strona główna
    ├── grota.html      # Grota Wygnańców
    ├── logo.png        # Logo Projekt Sojusz
    ├── grota_mapa.png  # Mapa groty
    ├── metin_icon.png  # Ikona metina
    └── reset.mp3       # Dźwięk resetu
```

## 🎮 Funkcje Groty Wygnańców

- **Pingowanie metinów** — kliknij na mapę → wybierz kanał (CH1-CH8)
- **Oznaczanie generałów** — przełącz tryb na "Generał" → kliknij na mapę
- **Globalne timery** — zmiany widoczne u wszystkich w czasie rzeczywistym (Socket.io)
- **Historia zbitych** — liczniki dostępnych metinów per kanał, timer 20-30min
- **Timery generałów** — respawn 6-8h, automatyczne statusy
- **Heatmapa** — wizualizacja gdzie najczęściej bijecie
- **Snapshoty** — zapis stanu mapy do późniejszego wczytania
- **Reset** — selektywne czyszczenie danych
