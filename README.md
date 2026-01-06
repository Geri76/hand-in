# Hand In

[![Bun](https://img.shields.io/badge/Bun-000000?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub stars](https://img.shields.io/github/stars/Geri76/hand-in?style=flat)](https://github.com/Geri76/hand-in/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/Geri76/hand-in?style=flat)](https://github.com/Geri76/hand-in/commits)

Egyszerű, helyi hálózaton használható fájlfeltöltő: a gép mDNS-en közzétesz egy `.local` címet, a böngészőben megnyitod, és egy fájlt fel tudsz tölteni.

## Funkciók

- mDNS-es cím a helyi hálózaton: `http://handin-xxxx.local`
- Egyszerű feltöltő oldal (GET `/` + POST `/upload`)
- „Zárolás” feltöltés után (IP vagy cookie alapú), hogy ugyanarról a kliensről ne legyen azonnal újrafeltöltés
- A feltöltött fájlok az `uploads/` könyvtárba kerülnek

## Követelmények

- [Bun](https://bun.sh/) telepítve
- Helyi hálózat és mDNS támogatás (Windows-on ez függhet a hálózati beállításoktól)

Megjegyzés: az app alapból a **80-as portra** figyel. Windows-on ehhez sokszor admin jog kell, vagy a portot már használja valami.

## Telepítés

```bash
bun install
```

## Futtatás (fejlesztés)

```bash
bun run dev
```

Induláskor a konzol kiír egy címet, pl.:

```
http://handin-abcd.local
```

Ezt a címet nyisd meg böngészőben ugyanazon a helyi hálózaton.

## Konfiguráció

A beállítások a gyökérben lévő `config.json` fájlban vannak. Ha nem létezik, a program induláskor létrehozza alapértelmezett értékekkel.

Példa:

```json
{
  "lockMode": "IP",
  "lockDuration": 300
}
```

- `lockMode`: `IP` vagy `COOKIE`
  - `IP`: a kliens IP-je alapján „egyszer tölthetsz fel” (amíg fut a program)
  - `COOKIE`: sütibe tesz egy rövid életű tokent
- `lockDuration`: csak `COOKIE` módban számít, másodpercben (pl. `300` = 5 perc)

Fontos: a zárolás állapota memóriában van; a program újraindításakor nullázódik.

## Hova menti a fájlokat?

- A feltöltött fájlok az `uploads/` mappába kerülnek.
- A fájlnév a kliens IP-jének egy „biztonságosabb” változatával egészül ki, pl. `dolgozat_192_168_1_10.pdf`.

## Végpontok

- `GET /` – feltöltő oldal (ha már „feltöltöttél”, az „already uploaded” oldal)
- `POST /upload` – fájlfeltöltés (`multipart/form-data`, mezőnév: `file`)
- `GET /stats` – verziók + amit a kliens feltöltött (zárolási módtól függően)
- `GET /health` – egyszerű healthcheck (`OK`)

## Build (önálló futtatható)

Windows-on készíthető egy önálló bináris:

```bash
bun run b
```

Ez egy `handin` nevű futtathatót generál (ikon: `icon.ico`). Indításkor ugyanúgy kiírja a `.local` címet.

## Hibaelhárítás

- Ha a `.local` cím nem nyílik meg:
  - ellenőrizd, hogy ugyanazon a helyi hálózaton vagytok
  - engedélyezd a hálózati forgalmat (Windows tűzfal felugró engedélykérés)
  - próbáld meg másik eszközről ugyanazon a hálózaton
- Ha a program nem tud elindulni 80-as porton:
  - futtasd emelt jogosultsággal, vagy szabadítsd fel a portot (ami épp használja)
