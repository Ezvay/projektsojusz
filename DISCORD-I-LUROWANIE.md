# Wdrożenie na Railway

Projekt jest przygotowany dla https://projekt-sojusz-production.up.railway.app.

## 1. Utwórz aplikację Discord

Otwórz https://discord.com/developers/applications i wybierz **New Application** (lub istniejącą aplikację).

W **OAuth2 → Redirects** dodaj dokładnie:

```
https://projekt-sojusz-production.up.railway.app/auth/discord/callback
```

Skopiuj **Application ID / Client ID** i **Client Secret**. Sekret wpisz tylko w Railway, nie w kodzie ani w wiadomości. Nie potrzeba tokenu bota ani instalowania bota: logowanie korzysta z uprawnień `identify` i `guilds.members.read`.

## 2. Ustaw Variables w Railway

| Zmienna | Wartość |
| --- | --- |
| DISCORD_CLIENT_ID | Application ID z panelu Discord |
| DISCORD_CLIENT_SECRET | Client Secret z panelu Discord |
| DISCORD_GUILD_ID | 1543972927719080016 |
| DISCORD_ADMIN_ROLE_ID | 1543979266084044820 |
| PUBLIC_URL | https://projekt-sojusz-production.up.railway.app |

Zachowaj dotychczasową konfigurację połączenia z MongoDB. Serwer i rola mają również powyższe wartości domyślne w kodzie. Jeśli pierwszy numer nie jest ID serwera Discord, popraw `DISCORD_GUILD_ID`.

## 3. Wgraj projekt i uruchom wdrożenie

Zastąp pliki projektu plikami z tej paczki. Railway powinno ponownie zainstalować zależności z `package.json` i uruchomić `node server.js`. Samo skopiowanie folderu `public` nie wystarczy.

Logowanie Discord zastępuje dotychczasowe hasło strony, formularze kont i rejestrację. Bez danych aplikacji pojawi się informacja o brakującej konfiguracji. Brak członkostwa w podanym serwerze blokuje dostęp. Administratorami są wyłącznie osoby z podaną rolą. Członkostwo i rola są ponownie sprawdzane co najwyżej co 5 minut podczas używania strony. Sesja wygasa po maksymalnie 12 godzinach; potem trzeba zalogować się ponownie.

Stare hasła i tokeny nie umożliwiają logowania. Nowe profile powstają w kolekcji `discord_users`, osobno od dawnej kolekcji `users`. Historycznych rekordów starej bazy nie kasujemy automatycznie. Dawne rezerwacje pozostają przypisane do dawnych kont; nie są automatycznie przejmowane po zgodności nazwy Discord. Tożsamość nowego gracza jest związana z niezmiennym ID Discord (`dc_ID`), a pasek logowania pokazuje jego nazwę z Discorda.

## Jak używać lurowania

Zmiana działa w **Mapie śmierci** i **Grocie Wygnańców**.

1. Administrator włącza rysowanie i dodaje numerek lub nazwę strefy, np. A1.
2. W trybie gry kliknij miejsce znalezienia generała na mapie i wybierz kanał.
3. Przytrzymaj ikonę generała i przeciągnij ją na oznaczenie strefy.
4. Ikona wskaże cel, a przerywana linia połączy go z pierwotnym miejscem znalezienia.

Cel jest zapisywany na serwerze i widoczny dla pozostałych zalogowanych graczy. Można przeciągnąć generała do kolejnej strefy. Upuszczenie poza oznaczeniem nie zmienia celu. Usunięcie numerka strefy usuwa jej widoczne połączenie i przywraca ikonę na pozycję znalezienia. Krótkie kliknięcie ikony nadal otwiera potwierdzenie zabicia.

Pole **Nieznany** w sidebarze nie dodaje już generała. Dodawanie odbywa się na mapie. Pozostałe dotychczasowe działania sidebara (zbicie, usunięcie historii) zostały zachowane.

## Sprawdzenie po wdrożeniu

Zaloguj się kontem z serwera Discord i sprawdź rysowanie kontem z rolą administratora. Następnie w dwóch oknach sprawdź dodanie generała i przeciągnięcie do numerka oraz odświeżenie strony. Sprawdź też odmowę dostępu dla konta spoza serwera.

Testy lokalne korzystają z symulowanych odpowiedzi Discorda i bazy. Prawdziwego logowania nie da się zakończyć bez danych aplikacji i ustawienia adresu powrotu w Discord Developer Portal.
