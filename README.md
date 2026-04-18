# ⚔ Sojusz Gildi – Metin2 Projekt Hard

Strona internetowa sojuszu gildi na serwerze Metin2 Projekt Hard.

## Funkcje

- 🗺 **Grota Wygnańców** – interaktywna mapa z pinowaniem Generałów
- ⏱ **Globalne timery** – oznaczenie bossa widoczne dla wszystkich graczy w czasie rzeczywistym
- 📡 **WebSocket** – aktualizacje bez odświeżania strony
- 🔴 **8 kanałów** – wybór CH1–CH8 przy oznaczaniu bossa

## Jak uruchomić lokalnie

```bash
npm install
npm start
```

Strona dostępna na `http://localhost:3000`

## Deployment na Render.com

1. Wrzuć kod na GitHub
2. Zaloguj się na [render.com](https://render.com)
3. Kliknij **New → Web Service**
4. Połącz z repozytorium GitHub
5. Render automatycznie wykryje `render.yaml` i skonfiguruje serwis
6. Poczekaj na deployment (~2 minuty)

## Dodawanie mapy Groty Wygnańców

Umieść plik `grota-map.jpg` w folderze `public/images/`.  
Jeśli plik nie istnieje, strona wyświetli automatycznie wygenerowaną mapę zastępczą.

## Dostosowanie pozycji Generałów

Edytuj plik `public/js/generals.js` – zmień wartości `x` i `y` (procenty względem mapy, 0–100).

## Struktura projektu

```
metin2-sojusz/
├── src/
│   └── server.js        # Backend Node.js + WebSocket + SQLite
├── public/
│   ├── index.html       # Strona główna
│   ├── css/style.css    # Style
│   ├── js/
│   │   ├── generals.js  # Definicje Generałów
│   │   └── app.js       # Logika frontendu
│   └── images/
│       └── grota-map.jpg  # (dodaj własną mapę)
├── render.yaml          # Konfiguracja Render.com
└── package.json
```
