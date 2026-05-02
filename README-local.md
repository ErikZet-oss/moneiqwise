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
LOCAL_AUTH_ALLOW_REMOTE=false
LOCAL_AUTH_SESSION_SECRET=please-change-me
LOCAL_AUTH_RESET_TOKEN_MINUTES=30
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX_REQUESTS=25
AUTH_LOCKOUT_MAX_ATTEMPTS=5
AUTH_LOCKOUT_MINUTES=15
```

Poznamka: ak mas v hesle znak `@`, musis ho v URL zapisat ako `%40`.

Priklad:

```env
DATABASE_URL=postgresql://postgres:MojeHeslo%40277@localhost:5432/moneiqwise
```

Poznamka k prihlaseniu:

- appka pouziva lokalny login/registraciu (email + heslo)
- `LOCAL_AUTH_ALLOW_REMOTE=false` povoli prihlasenie len z localhost
- `LOCAL_AUTH_SESSION_SECRET` nastav na vlastnu hodnotu (najma mimo local dev)
- `LOCAL_AUTH_RESET_TOKEN_MINUTES` urcuje platnost reset tokenu
- `AUTH_RATE_LIMIT_*` limity pre login/register/reset endpointy
- `AUTH_LOCKOUT_*` docasne zamknutie uctu po neuspesnych login pokusoch
- **Schvaľovanie registrácií (voliteľné):**
  - `LOCAL_AUTH_REGISTRATION_REQUIRES_APPROVAL=true` — nový používateľ je v stave „čaká“, kým ho správca neschváli; **prvý účet v databáze** je vždy schválený automaticky (bootstrap).
  - `LOCAL_AUTH_ADMIN_EMAILS=tvoj@email.com,druhy@email.com` — tieto emaily (lokálne prihlásenie) uvidia v menu položku **Registrácie** a môžu schvaľovať / blokovať účty.
  - Po `db:push` alebo prvom štarte server doplní stĺpec `registration_status` na `users`, ak chýba.

## 3) Priprava databazy

V pgAdmin alebo psql vytvor databazu:

- nazov: `moneiqwise`

Potom spusti migraciu schemy:

```powershell
npm run db:push
```

Ak by `db:push` zlyhalo na starsich lokalnych datach, vytvor auth tabulky manualne:

```powershell
node -e "require('dotenv').config(); const { Client } = require('pg'); (async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); await c.query('CREATE TABLE IF NOT EXISTS local_auth_accounts (id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id varchar NOT NULL UNIQUE REFERENCES users(id), email varchar NOT NULL UNIQUE, password_hash text NOT NULL, password_salt text NOT NULL, created_at timestamp DEFAULT now())'); await c.query('CREATE TABLE IF NOT EXISTS local_password_resets (id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id varchar NOT NULL REFERENCES users(id), email varchar NOT NULL, token_hash text NOT NULL UNIQUE, expires_at timestamp NOT NULL, used_at timestamp, created_at timestamp DEFAULT now())'); await c.end(); console.log('local auth tables ready'); })();"
```

## 4) Spustenie aplikacie

```powershell
npm run dev
```

Aplikacia pobezi na:

- http://localhost:5000

## 4b) Prihlasenie funguje na live, ale nie local

- Vzdy pouzivaj **rovnaky host** v prehliadaci: `http://localhost:5000` **alebo** `http://127.0.0.1:5000` (nemiesaj – cookies su per host).
- Po zmene auth skus v DevTools vymazat **Local Storage** klic `portfolio-query-cache` pre tuto domenu.
- `npm run dev` pouziva `NODE_ENV=development` – kontrola „len localhost IP“ sa pri nom **neaplikuje** (na rozdiel od produkcie).

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
