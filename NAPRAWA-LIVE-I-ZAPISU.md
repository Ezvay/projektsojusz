# Poprawka połączenia live i zapisu map

## Wdrożenie

Wgraj cały projekt z tej paczki do dotychczasowej usługi Railway, zachowując obecne Variables Discorda i MongoDB. Wykonaj ponowne wdrożenie z instalacją zależności z `package.json`. Po wdrożeniu odśwież stronę przez Ctrl+F5.

Nowe pliki `map-state.js` oraz `public/map-sync.js` są wymagane. Zmieniono także `server.js`, `discord-auth.js`, `package.json`, `public/grota.html` i `public/smierc.html`. Samo wgranie HTML nie wystarczy.

Ta wersja zakłada jedną replikę usługi Railway. Nie wymaga Redis ani dodatkowej płatnej usługi. Przy wielu replikach potrzebny byłby wspólny mechanizm rozsyłania zdarzeń; obecna wersja wykrywa konflikt zapisu, ale nie zapewnia synchronizacji live między oddzielnymi procesami.

## Co poprawiono

- Logowanie sesji przy połączeniu live obsługuje żądania z własnej strony, które nie zawierają nagłówka Origin. Sesja Discord nadal jest sprawdzana, a obce pochodzenie przeglądarki jest odrzucane.
- Generałowie, cele lurowania, trasy, numerki, gracze na trasach i snapshoty są zapisywani w MongoDB, osobno dla każdej mapy.
- Zmiana jest rozsyłana dopiero po udanym zapisie. Pasek nad sidebarem pokazuje pobieranie danych, zapisywanie, potwierdzenie lub błąd. Przy braku połączenia edycja nie udaje, że dane zostały zapisane.
- Błędny zapis nie zostawia na mapie lokalnego, niezapisanego numerka. Niepotwierdzona trasa pozostaje szkicem do ponowienia.
- Istniejące dane z dawnego dokumentu `state/main` są przy pierwszym uruchomieniu kopiowane do kolekcji `map_states`. Oryginał pozostaje zachowany. Kolejne uruchomienia korzystają z nowego zapisu.

## Ograniczenie ruchu i zapisów

- Jedno stałe połączenie WebSocket na otwartą mapę; zapasowo działa transport polling.
- Brak cyklicznego pobierania stanu mapy i brak zapisów bez zmian. Pozostają niewielkie pakiety sprawdzające połączenie.
- Dane mapy otrzymują tylko użytkownicy oglądający tę samą mapę.
- Po edycji przesyłana jest zmieniona kategoria danych: np. lista numerków zamiast tras, numerków i graczy razem. Ruch kursora i kolejne punkty szkicu nie są wysyłane — dopiero ukończona trasa lub cel przeciągnięcia.
- Timery nie zapisują całego stanu do bazy co sekundę. Działające timery mają jeden wspólny komunikat na sekundę do widzów timerów, zamiast osobnego komunikatu dla każdego uruchomionego timera. Widzowie map tych komunikatów nie otrzymują.
- Sprawdzenia tej samej sesji korzystają z 30-sekundowej pamięci podręcznej. Discord nadal jest odpytywany o członkostwo i rolę zgodnie z dotychczasowym limitem 5 minut.
- Grafiki i dźwięki mogą być przechowywane przez przeglądarkę przez 7 dni, więc nie muszą być ponownie przesyłane przy każdym odświeżeniu.

Rzeczywisty rachunek zależy od liczby osób, czasu działania, hostingu i bazy. Ta poprawka ogranicza zbędny ruch, ale nie wyznacza ani nie gwarantuje miesięcznej ceny.

## Testy

Odtworzono błąd starego uwierzytelniania na prawdziwym połączeniu Socket.IO. Poprawkę przetestowano w dwóch prawdziwych oknach przeglądarki: dodawanie generała, wspólne trasy i strefy, odświeżenie, ponowne uruchomienie serwera, lurowanie, uprawnienia i awaria zapisu. Dodatkowy test pełnego kodu serwera sprawdził migrację starej mapy i 16 timerów: jeden wspólny interwał, bez zapisów do bazy przy 60 tyknięciach. Testy korzystały z testowego zamiennika MongoDB, bez dostępu do produkcyjnej bazy użytkownika.

Po wdrożeniu otwórz mapę w dwóch oknach. Poczekaj na „Na żywo · dane wczytane”, dodaj generała i numerek, sprawdź drugie okno, następnie poczekaj na „Zapisano · na żywo” i odśwież. W razie problemów sprawdź komunikat nad sidebarem i logi Railway.
