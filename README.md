# 🪂 Dropzone Royale

**An original, zero-dependency browser battle royale.** 25 fighters drop into a shrinking Zone, scavenge weapons, harvest materials, throw up walls, and fight until one walks out.

Built entirely with vanilla JavaScript and the HTML5 Canvas API — no frameworks, no build step, no assets to download. Three files and a browser is all it takes.

> **Disclaimer:** This is a from-scratch fan project inspired by the *battle royale genre*. It is not a copy of, affiliated with, or endorsed by Epic Games or any other studio, and it contains no assets, code, characters, or branding from Fortnite or any other commercial game.

---

## 🎮 Play

**Option 1 — just open it**

Download or clone the repo and open `index.html` in any modern browser. That's it.

**Option 2 — serve it locally**

```bash
git clone https://github.com/Kaushik-hub306/dropzone-royale.git
cd dropzone-royale
npx serve .        # or: python3 -m http.server 8080
```

**Option 3 — GitHub Pages**

Repo **Settings → Pages → Deploy from a branch → `main` / (root)** and the game goes live at `https://kaushik-hub306.github.io/dropzone-royale/`. (Pages on the free plan requires the repo to be public.)

## 🕹️ Controls

| Input | Action |
|---|---|
| **W A S D** / arrows | Move |
| **Mouse** | Aim |
| **Left click** (hold for autos) | Fire |
| **F** | Melee swing — damages enemies, harvests materials from trees, rocks & crates |
| **Q** or **right-click** | Build a cover wall (10 materials) |
| **E** | Swap to the weapon at your feet |
| **M** | Mute / unmute |
| **R** | Restart (after elimination or victory) |

## ✨ Features

- **24 AI opponents** — they scavenge for weapons, heal when hurt, pick targets, strafe in fights, check line-of-sight before shooting, and rotate when the Zone closes
- **The Zone** — 7 shrink phases with escalating damage, a dashed target ring so you can rotate early, and a minimap that shows both circles
- **5 weapon archetypes** — Pistol, SMG, Shotgun, Battle Rifle, Sniper, each with distinct damage, fire rate, spread, projectile speed, and range
- **Harvest & build** — melee trees, rocks, and crates for materials, then drop cover walls mid-fight; walls have HP and can be shot down
- **Loot economy** — floor spawns, crate drops, and eliminated fighters dropping their gear
- **Juice** — kill feed, spectator mode after elimination, hit sparks, muzzle flashes, camera shake, synthesized sound effects (WebAudio, no audio files)

## 🧠 How it works

Everything lives in `game.js` (~900 lines):

- **Game loop** — `requestAnimationFrame` with a clamped delta-time; fixed update + render passes
- **Entities** — fighters (player and bots share one struct), projectiles, pickups, obstacles, and particles in flat arrays
- **Zone** — a phase state machine (`wait → shrink`) interpolating between circles; the next circle is always sampled fully inside the current one
- **Bot AI** — a priority stack evaluated every ~0.3s: escape the Zone → fight (armed) → flee/melee (unarmed) → grab loot → wander
- **Collision** — circle-vs-circle and circle-vs-AABB resolution for movement; projectiles substep-sample their path so fast bullets can't tunnel through walls
- **Rendering** — camera-transformed canvas with layered draw order (ground → loot → structures → fighters → tree canopies → Zone overlay → minimap)

## 🔧 Tuning

All the knobs are constants at the top of `game.js`: world size, bot count, movement speeds, weapon stats (`WEAPONS`), Zone pacing (`PHASES`), wall cost/HP, harvest rates, and more. Change a number, refresh, play.

## 🗺️ Roadmap ideas

- [ ] Touch controls for mobile
- [ ] Duos / squads with allied bot AI
- [ ] More structures & named locations on the map
- [ ] Supply drops that lure fighters mid-match
- [ ] Online multiplayer via WebRTC data channels

## 📄 License

[MIT](LICENSE) — do whatever you like, attribution appreciated.
