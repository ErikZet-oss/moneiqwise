# Moneiqwise - Lokalny start (Windows)

Tento navod je pre rychle lokalne spustenie projektu.

## 30-second startup

Ked uz mas projekt raz nastaveny, pri dalsom starte sprav iba toto:

1. Zapni PostgreSQL
2. V koreni projektu spusti:

```powershell
npm run dev
```

3. Otvor:

- http://localhost:5000

## 1) Co musis mat nainstalovane

- Node.js 20+
- PostgreSQL 14+ (beziaca lokalna sluzba)

Overenie v terminali:

```powershell
node -v
npm -v
```

## 2) Prva konfiguracia projektu

V koreni projektu spusti:

```powershell
npm install
copy .env.example .env
```

Potom otvor `.env` a nastav hlavne:

```env
DATABASE_URL=postgresql://postgres:HESLO@localhost:5432/moneiqwise
PORT=5000
```

Poznamka: ak mas v hesle znak `@`, musis ho v URL zapisat ako `%40`.

Priklad:

```env
DATABASE_URL=postgresql://postgres:MojeHeslo%40277@localhost:5432/moneiqwise
```

## 3) Priprava databazy

V pgAdmin alebo psql vytvor databazu:

- nazov: `moneiqwise`

Potom spusti migraciu schemy:

```powershell
npm run db:push
```

## 4) Spustenie aplikacie

```powershell
npm run dev
```

Aplikacia pobezi na:

- http://localhost:5000

## 5) Najcastejsi problem: "connection failed"

Vo vacsine pripadov to znamena, ze nebezi backend.

Skontroluj:

1. Bezi PostgreSQL (port 5432)?
2. Si v koreni projektu?
3. Bezi `npm run dev` bez chyby?
4. Mas spravne `DATABASE_URL` v `.env`?

Rychly test DB spojenia:

```powershell
node -e "require('dotenv').config(); const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DATABASE_URL }); c.connect().then(()=>{console.log('DB connect OK'); return c.end();}).catch(e=>{console.error('DB connect FAIL:', e.message); process.exit(1);});"
```

Ak `npm run dev` bezi a DB test da `DB connect OK`, otvor stranku nanovo (hard refresh).

## 6) Bezne pouzivanie

Pri dalsom starte stacia 2 kroky:

1. Zapnut PostgreSQL
2. V projekte spustit `npm run dev`
