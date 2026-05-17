const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { autoUpdater } = require('electron-updater'); // DODANO: Moduł auto-updater

// --- KONFIGURACJA AUTO-UPDATERA ---
autoUpdater.autoDownload = false; // Zapytaj użytkownika przed pobraniem
autoUpdater.allowPrerelease = false;

// --- KONFIGURACJA ŚCIEŻKI BAZY DANYCH ---
const dbPath = app.isPackaged 
    ? path.join(app.getPath('userData'), 'klienci.db') 
    : path.join(__dirname, 'klienci.db');

// Inicjalizacja bazy danych pod właściwą ścieżką
const db = new Database(dbPath);

// 1. TWORZENIE TABEL (KLIENCI, SPRZĘT, NAPRAWY ORAZ ROZLICZENIA)
db.exec(`
  CREATE TABLE IF NOT EXISTS klienci (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imie TEXT,
    nazwisko TEXT,
    firma TEXT,
    nip TEXT,
    ulica TEXT,
    dom TEXT,
    lokal TEXT,
    miasto TEXT,
    kod TEXT,
    email TEXT,
    email2 TEXT,
    tel TEXT,
    tel2 TEXT,
    opis TEXT
  );

  CREATE TABLE IF NOT EXISTS sprzet (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nazwa TEXT,
    typ TEXT,
    status_magazyn TEXT,
    data_wydania TEXT,
    wartosc TEXT,
    sn TEXT,
    stan TEXT,
    bateria TEXT,
    zasilacz TEXT,
    gwarancja TEXT,
    inne TEXT,
    wlasciciel TEXT
  );

  CREATE TABLE IF NOT EXISTS naprawy (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT,
    data_przyjecia TEXT,
    data_ukonczenia TEXT,
    typ TEXT,
    koszt TEXT,
    nr_zewnetrzny TEXT,
    opis_uszkodzenia TEXT,
    komentarz TEXT,
    id_klienta INTEGER,
    id_sprzetu INTEGER,
    zdjecia TEXT
  );

  CREATE TABLE IF NOT EXISTS rozliczenia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_klienta INTEGER,
    id_naprawy INTEGER,
    id_sprzetu INTEGER,
    kwota_netto TEXT,
    kwota_brutto TEXT,
    koszt_czesci TEXT,
    koszt_pracy TEXT,
    koszt_zewnetrzny TEXT,
    opis TEXT,
    status TEXT,
    data_dodania TEXT,
    data_rozliczenia TEXT,
    rozliczyl TEXT
  );
`);

// BEZPIECZNA AKTUALIZACJA BAZY (DODAWANIE BRAKUJĄCYCH KOLUMN)
try {
    db.exec("ALTER TABLE naprawy ADD COLUMN opis_naprawy TEXT;");
} catch (err) {
    // Kolumna już istnieje
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1100,
    minWidth: 1300, // BLOKADA ZMNIEJSZANIA - ratuje wygląd (nie da się zwęzić poniżej tej wartości)
    minHeight: 800, // BLOKADA ZMNIEJSZANIA
    title: "TechFixStudio-Service",
    icon: path.join(__dirname, 'logo.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
  win.maximize();

  // DODANO: Sprawdź aktualizacje po załadowaniu okna
  win.once('ready-to-show', () => {
    autoUpdater.checkForUpdatesAndNotify();
  });

  // --- OBSŁUGA ZAMYKANIA PROGRAMU (X) ---
  win.on('close', (e) => {
    // Wyświetla okienko z pytaniem (Zatrzymuje kod do momentu kliknięcia)
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', // Typ ikonki (ostrzeżenie)
      buttons: ['Tak, zamknij', 'Nie, anuluj'], // Przyciski (indeks 0 to Tak, indeks 1 to Nie)
      title: 'Zamykanie programu',
      message: 'Czy na pewno chcesz zamknąć program?',
      detail: 'Niezapisane zmiany w formularzach mogą zostać utracone.',
      defaultId: 1, // Domyślnie zaznaczony przycisk "Nie" (żeby przypadkowy Enter nie zamknął)
      cancelId: 1   // Co się stanie po wciśnięciu ESC (też "Nie")
    });

    // Jeśli użytkownik wybrał przycisk o indeksie 1 ("Nie, anuluj")
    if (choice === 1) {
      e.preventDefault(); // Przerywa proces zamykania okna
    }
  });
}

// --- LOGIKA AUTO-UPDATERA (POWIADOMIENIA I INSTALACJA) ---

// Zdarzenie: Znaleziono nową wersję na serwerze
autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Dostępna aktualizacja',
        message: `Znalazłem nowszą wersję programu (${info.version}). Czy chcesz ją pobrać teraz?`,
        buttons: ['Pobierz', 'Później']
    }).then(result => {
        if (result.response === 0) {
            autoUpdater.downloadUpdate();
        }
    });
});

// Zdarzenie: Pliki zostały pobrane, gotowe do instalacji
autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
        type: 'question',
        title: 'Aktualizacja gotowa do instalacji',
        message: 'Nowa wersja programu została pobrana. Program musi zostać zrestartowany, aby wprowadzić zmiany. Czy chcesz zrestartować go teraz?',
        buttons: ['Restartuj i aktualizuj', 'Później']
    }).then(result => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });
});

// Zdarzenie: Błąd podczas sprawdzania lub pobierania aktualizacji
autoUpdater.on('error', (err) => {
    console.error("Błąd podczas aktualizacji: ", err);
});

// --- OBSŁUGA KOMUNIKACJI IPC (KLIENCI) ---

ipcMain.handle('dodaj-klienta', (event, k) => {
    try {
        const stmt = db.prepare(`
            INSERT INTO klienci (
                imie, nazwisko, firma, nip, ulica, dom, lokal, 
                miasto, kod, email, email2, tel, tel2, opis
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const info = stmt.run(
            k.imie || '', k.nazwisko || '', k.firma || '', k.nip || '', 
            k.ulica || '', k.dom || '', k.lokal || '', k.miasto || '', 
            k.kod || '', k.email || '', k.email2 || '', k.tel || '', 
            k.tel2 || '', k.opis || ''
        );
        return info.lastInsertRowid; 
    } catch (err) {
        console.error("Błąd podczas dodawania klienta:", err);
        throw err;
    }
});

ipcMain.handle('get-klienci', () => {
    try {
        return db.prepare('SELECT * FROM klienci ORDER BY id DESC').all();
    } catch (err) {
        console.error("Błąd pobierania danych klientów:", err);
        return [];
    }
});

ipcMain.on('usun-klienta', (event, id) => {
    try {
        const transaction = db.transaction(() => {
            db.prepare(`DELETE FROM sprzet WHERE wlasciciel LIKE ?`).run(`#${id} %`);
            db.prepare('DELETE FROM klienci WHERE id = ?').run(id);
        });
        transaction();
        event.reply('klient-usuniety');
    } catch (err) {
        console.error("Błąd podczas usuwania:", err);
    }
});

ipcMain.on('edytuj-klienta', (event, dane) => {
    try {
        const transaction = db.transaction(() => {
            const stmt = db.prepare(`
                UPDATE klienci 
                SET imie = ?, nazwisko = ?, firma = ?, nip = ?, ulica = ?, 
                    dom = ?, lokal = ?, miasto = ?, kod = ?, email = ?, 
                    email2 = ?, tel = ?, tel2 = ?, opis = ?
                WHERE id = ?
            `);
            stmt.run(
                dane.imie || '', dane.nazwisko || '', dane.firma || '', dane.nip || '', 
                dane.ulica || '', dane.dom || '', dane.lokal || '', dane.miasto || '', 
                dane.kod || '', dane.email || '', dane.email2 || '', dane.tel || '', 
                dane.tel2 || '', dane.opis || '', dane.id
            );

            let nazwaK = `${dane.imie || ''} ${dane.nazwisko || ''}`.trim();
            if (!nazwaK) nazwaK = dane.firma || '';
            const nowyWlascicielString = `#${dane.id} ${nazwaK}`;
            const wzorDoWyszukania = `#${dane.id} %`;

            db.prepare(`UPDATE sprzet SET wlasciciel = ? WHERE wlasciciel LIKE ?`)
              .run(nowyWlascicielString, wzorDoWyszukania);
        });
        transaction();
        event.reply('klient-edytowany');
    } catch (err) {
        console.error("Błąd podczas aktualizacji klienta:", err);
    }
});

// --- OBSŁUGA KOMUNIKACJI IPC (SPRZĘT) ---

ipcMain.handle('dodaj-sprzet', (event, s) => {
    try {
        const stmt = db.prepare(`
            INSERT INTO sprzet (
                nazwa, typ, status_magazyn, data_wydania, wartosc, 
                sn, stan, bateria, zasilacz, gwarancja, inne, wlasciciel
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
            s.nazwa || '', s.typ || '', s.status_magazyn || '', s.data_wydania || '', 
            s.wartosc || '', s.sn || '', s.stan || '', s.bateria || '', s.zasilacz || '', 
            s.gwarancja || '', s.inne || '', s.wlasciciel || ''
        );
        return info.lastInsertRowid;
    } catch (err) {
        console.error("Błąd podczas dodawania sprzętu:", err);
        throw err;
    }
});

ipcMain.handle('get-sprzet', () => {
    try {
        return db.prepare('SELECT * FROM sprzet ORDER BY id DESC').all();
    } catch (err) {
        console.error("Błąd pobierania danych sprzętu:", err);
        return [];
    }
});

ipcMain.on('usun-sprzet', (event, id) => {
    try {
        const stmt = db.prepare('DELETE FROM sprzet WHERE id = ?');
        stmt.run(id);
        event.reply('sprzet-usuniety');
    } catch (err) {
        console.error("Błąd podczas usuwania sprzętu:", err);
    }
});

ipcMain.on('edytuj-sprzet', (event, dane) => {
    try {
        const params = [
            dane.nazwa || '', dane.typ || '', dane.status_magazyn || '', dane.sn || '', 
            dane.stan || '', dane.bateria || '', dane.zasilacz || '', dane.gwarancja || '', dane.inne || ''
        ];
        let zapytanie = `
            UPDATE sprzet 
            SET nazwa = ?, typ = ?, status_magazyn = ?, sn = ?, stan = ?, 
                bateria = ?, zasilacz = ?, gwarancja = ?, inne = ?
        `;
        if (dane.wlasciciel !== undefined) {
            zapytanie += `, wlasciciel = ?`;
            params.push(dane.wlasciciel);
        }
        zapytanie += ` WHERE id = ?`;
        params.push(dane.id);

        db.prepare(zapytanie).run(...params);
        event.reply('sprzet-edytowany');
    } catch (err) {
        console.error("Błąd podczas aktualizacji sprzętu:", err);
    }
});

// --- OBSŁUGA KOMUNIKACJI IPC (NAPRAWY) ---

ipcMain.handle('dodaj-naprawe', (event, n) => {
    try {
        const stmt = db.prepare(`
            INSERT INTO naprawy (
                status, data_przyjecia, data_ukonczenia, typ, koszt,
                nr_zewnetrzny, opis_uszkodzenia, opis_naprawy, komentarz, id_klienta, id_sprzetu, zdjecia
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
            n.status || '', n.data_przyjecia || '', n.data_ukonczenia || '', n.typ || '', 
            n.koszt || '', n.nr_zewnetrzny || '', n.opis_uszkodzenia || '', n.opis_naprawy || '', 
            n.komentarz || '', n.id_klienta || null, n.id_sprzetu || null, n.zdjecia || '[]'
        );
        return info.lastInsertRowid;
    } catch (err) {
        console.error("Błąd podczas dodawania naprawy:", err);
        throw err;
    }
});

ipcMain.handle('get-naprawy', () => {
    try {
        return db.prepare('SELECT * FROM naprawy ORDER BY id DESC').all();
    } catch (err) {
        console.error("Błąd pobierania danych napraw:", err);
        return [];
    }
});

ipcMain.on('usun-naprawe', (event, id) => {
    try {
        const stmt = db.prepare('DELETE FROM naprawy WHERE id = ?');
        stmt.run(id);
        event.reply('naprawa-usunieta');
    } catch (err) {
        console.error("Błąd podczas usuwania naprawy:", err);
    }
});

ipcMain.on('edytuj-naprawe', (event, n) => {
    try {
        const stmt = db.prepare(`
            UPDATE naprawy 
            SET status = ?, data_przyjecia = ?, data_ukonczenia = ?, typ = ?, 
                koszt = ?, nr_zewnetrzny = ?, opis_uszkodzenia = ?, opis_naprawy = ?, komentarz = ?, zdjecia = ?
            WHERE id = ?
        `);
        stmt.run(
            n.status || '', n.data_przyjecia || '', n.data_ukonczenia || '', n.typ || '', 
            n.koszt || '', n.nr_zewnetrzny || '', n.opis_uszkodzenia || '', n.opis_naprawy || '', 
            n.komentarz || '', n.zdjecia || '[]', n.id
        );
        event.reply('naprawa-edytowana');
    } catch (err) {
        console.error("Błąd podczas aktualizacji naprawy:", err);
    }
});

// --- OBSŁUGA KOMUNIKACJI IPC (ROZLICZENIA) ---

ipcMain.handle('dodaj-rozliczenie', (event, r) => {
    try {
        const stmt = db.prepare(`
            INSERT INTO rozliczenia (
                id_klienta, id_naprawy, id_sprzetu, kwota_netto, kwota_brutto, 
                koszt_czesci, koszt_pracy, koszt_zewnetrzny, opis, status, 
                data_dodania, data_rozliczenia, rozliczyl
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
            r.id_klienta || null, r.id_naprawy || null, r.id_sprzetu || null,
            r.kwota_netto || '', r.kwota_brutto || '', r.koszt_czesci || '',
            r.koszt_pracy || '', r.koszt_zewnetrzny || '', r.opis || '',
            r.status || '', r.data_dodania || '', r.data_rozliczenia || '', r.rozliczyl || ''
        );
        return info.lastInsertRowid;
    } catch (err) {
        console.error("Błąd podczas dodawania rozliczenia:", err);
        throw err;
    }
});

ipcMain.handle('get-rozliczenia', () => {
    try {
        // Łączymy tabele, aby zamiast "id_klienta" wysłać do widoku od razu Imię i Nazwisko
        return db.prepare(`
            SELECT r.*, 
                   IFNULL(k.imie || ' ' || k.nazwisko, k.firma) as klient,
                   s.nazwa as sprzet,
                   r.id_naprawy as nr_naprawy,
                   r.koszt_czesci as koszt_części
            FROM rozliczenia r
            LEFT JOIN klienci k ON r.id_klienta = k.id
            LEFT JOIN sprzet s ON r.id_sprzetu = s.id
            ORDER BY r.id DESC
        `).all();
    } catch (err) {
        console.error("Błąd pobierania rozliczeń:", err);
        return [];
    }
});

ipcMain.on('usun-rozliczenie', (event, id) => {
    try {
        const stmt = db.prepare('DELETE FROM rozliczenia WHERE id = ?');
        stmt.run(id);
        event.reply('rozliczenie-usuniete');
    } catch (err) {
        console.error("Błąd podczas usuwania rozliczenia:", err);
    }
});

ipcMain.on('edytuj-rozliczenie', (event, r) => {
    try {
        const stmt = db.prepare(`
            UPDATE rozliczenia 
            SET kwota_netto = ?, kwota_brutto = ?, koszt_czesci = ?, koszt_pracy = ?, 
                koszt_zewnetrzny = ?, opis = ?, status = ?, data_rozliczenia = ?, rozliczyl = ?
            WHERE id = ?
        `);
        stmt.run(
            r.kwota_netto || '', r.kwota_brutto || '', r.koszt_czesci || '', r.koszt_pracy || '', 
            r.koszt_zewnetrzny || '', r.opis || '', r.status || '', r.data_rozliczenia || '', r.rozliczyl || '', r.id
        );
        event.reply('rozliczenie-edytowane');
    } catch (err) {
        console.error("Błąd podczas aktualizacji rozliczenia:", err);
    }
});

// --- CYKL ŻYCIA APLIKACJI ---

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});