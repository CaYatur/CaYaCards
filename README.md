# CaYa Cards — 3D Çok Oyunculu Kart Oyunu

Web tabanlı, **3D**, **çok oyunculu**, UNO benzeri bir kart oyunu. Bilgisayar, tablet ve telefonda
oynanır. Oda kurma, 4 haneli oda koduyla katılma ve herkese açık oda listesi vardır. Her oyuncu masada
3D bir karakter olarak görünür ve şapka / gözlük / yüz / renk / aura kozmetikleri seçebilir.

Kartlar `/cards` klasöründeki **AI temalı deste** (SVG/PNG) ile çizilir: renkler amber · blue · clay ·
green, jokerler ve 10 özel "x-" kartı (`hallucination alarmı`, `429 rate limited`, `token budget bitti`…).

## Özellikler
- Sunucu otoriter oyun motoru: sıra/yön, +2/+4 istifleme, "Son kart!" çağrısı ve unutulursa otomatik +2 ceza, botlar
- Oda kodu, herkese açık lobi, bot ekleme, sohbet, sesler
- 30 sn sıra sayacı (süre dolunca otomatik kart çekilir), bağlantı koparsa 90 sn bekleme ve kaldığı yerden devam
- Modlar: Klasik, Kaos (7-0 kuralı), Eğlence (cezalı mini görevler: çizim, emoji, bilgi yarışması, refleks oyunları…),
  Turbo, Acımasız (eşleşene kadar çek), Bol Joker, Çift Deste, Bomba
- Kazanan bir bitiriş animasyonu seçer (podyum, örs, silindir, TNT…)

## Teknolojiler
Node.js (ES modules), Express, Socket.IO, three.js (`node_modules`'tan yerel servis edilir, CDN yok), nanoid.

## Çalıştırma
```bash
npm install
npm start          # http://localhost:3000
PORT=4000 npm start
npm run dev        # node --watch ile otomatik yeniden başlatma
```
Aynı ağdaki telefon/tabletten `http://<bilgisayarın-yerel-IP'si>:3000` ile bağlanılır. Tek ortam değişkeni `PORT` (varsayılan 3000).

## Nasıl oynanır / kontroller
İsmini yaz, karakterini özelleştir, oda kur ya da kodla katıl, gerekirse bot ekle ve başlat.
Sıran gelince oynanabilir bir karta dokun; joker oynarsan renk seç. Uygun kartın yoksa desteden çek ya da pas geç.
Tek kartın kalınca **Son kart!** butonuna bas. Masada sürükleyerek gezin, tekerlek/pinch ile yakınlaş,
**⟳ Kamera** ile sıfırla, 💬 ile sohbet et, 🔊 ile sesi aç/kapat.

## Yapı
```
server/  index.js (Express + Socket.IO), rooms.js, game.js (kural motoru), deck.js
public/  index.html, css/style.css, js/ (main, net, scene3d, avatars, cards, ui, cosmetics, charcreator, taskmode, sound)
cards/   SVG + PNG deste
```

## Bilinen sorunlar
- Odalar ve oyun durumu yalnızca sunucu belleğinde tutulur; sunucu yeniden başlarsa silinir.
- Kimlik doğrulama yoktur; oyuncu kimliği tarayıcının `localStorage`'ında saklanır.
- Lisans belirtilmemiştir (`package.json` içinde MIT yazsa da ayrı bir LICENSE dosyası yoktur).

## Proje tarihleri
- **Oluşturma:** 21 Haziran 2026
- **Son güncelleme:** 3 Temmuz 2026

---

# CaYa Cards — 3D Multiplayer Card Game (English)

A web-based **3D multiplayer UNO-like card game** for desktop, tablet and phone. Create a public or
private room, share the 4-digit code or join from the public list, and sit at the table as a
customizable 3D character. The deck in `/cards` is AI-themed (amber · blue · clay · green, wilds and
10 special "x-" cards).

## Features
- Server-authoritative rules engine: turn/direction, +2/+4 stacking, "Last card!" call with automatic +2 penalty, bots
- Room codes, public lobby, bots, chat, sound effects
- 30 s turn timer, reconnect support (game pauses up to 90 s)
- Modes: Classic, Chaos (7-0 rule), Fun (penalty mini-games), Turbo, Ruthless (draw-to-match), Wild-heavy, Double deck, Bomb
- Winner picks a cartoon finisher celebration

## Tech
Node.js (ES modules), Express, Socket.IO, three.js (served locally), nanoid.

## Run
```bash
npm install
npm start          # http://localhost:3000
PORT=4000 npm start
```
The only environment variable is `PORT` (default 3000).

## How to play
Tap a playable card, pick a color for wilds, draw if you can't play, and press **Son kart!** (Last card!)
when one card is left. Drag to orbit, wheel/pinch to zoom, ⟳ resets the camera. The UI is in Turkish.

## Known issues
- Rooms live in server memory only.
- No authentication (identity in browser `localStorage`).
- No license specified (no LICENSE file).

## Project dates
- **Created:** June 21, 2026
- **Last updated:** July 3, 2026

> CaYa Cards is an independent hobby project. It is not affiliated with, endorsed by or sponsored by
> Mattel (owner of the UNO trademark) or Anthropic. The AI-themed card and bot names are a humorous theme only.
