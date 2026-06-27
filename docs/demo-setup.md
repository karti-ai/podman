# Demo Setup

Pre-stage checklist for the 3-minute live demo. Do this on all 3 laptops before walking on stage.

---

## Before demo day

- [ ] `demo-pod` room created in LiveKit Cloud dashboard
- [ ] Hermes deployed on DO (or confirmed running locally as fallback)
- [ ] MongoDB Atlas cluster running, `MONGODB_URI` set in Hermes env
- [ ] All `.env` vars populated and verified via `GET /health` returning `{ ok: true }`
- [ ] Record a backup video of the full demo working end-to-end
- [ ] Rehearse the demo script 3× with real audio

---

## Laptop setup (all 3 machines)

### Editor settings
- Font size: **18pt or larger** — Gemini Vision must read file names and code
- Single editor window — no split panes, no overlapping terminals
- File tab visible with full file name shown (not truncated)
- Light or dark theme is fine — avoid low-contrast themes

### Browser
- Chrome (best `getDisplayMedia` support)
- PWA tab open and joined to `demo-pod`
- Earbuds / headphones plugged in and tested
- Volume: medium — PodMan voice should be clearly audible but not startle

### Screen layout
- Editor takes 2/3 of screen
- Terminal takes bottom 1/3 (always visible)
- No other windows on top

---

## Demo file setup

Pre-create these files in the demo repo before the demo:

**Alice's machine:**
- Open `auth/middleware.ts` — has visible function stubs
- Terminal shows nothing running initially, then `Server running on :3001` at the right moment

**Bob's machine:**
- Open `frontend/login.tsx` — has visible form component code
- Terminal idle

**Carol's machine:**
- Open `frontend/integration.ts` or similar
- Terminal shows: `curl http://localhost:3001/auth` → `curl: (7) Failed to connect`

---

## Demo script timing

| Time | Action | Who |
|---|---|---|
| 0:00 | All three join `demo-pod` | All |
| 0:05 | PodMan greets by voice | Hermes auto |
| 0:20 | Alice opens `auth/middleware.ts`, starts typing | Alice |
| 0:45 | Bob opens `frontend/login.tsx` | Bob |
| 0:50 | Carol runs `curl` command, sees error | Carol |
| ~1:20 | BLOCKER_DETECTED nudge fires | Hermes auto |
| 1:50 | Alice starts her server (`node server.js`) | Alice |
| ~2:00 | DEPENDENCY_READY nudge fires | Hermes auto |
| 2:20 | Optional: show session 2 ownership warm-start | Presenter |
| 2:45 | Close | Presenter |

---

## Gemini Vision reliability tips

- Keep font at 18pt+ throughout the demo — do not zoom out
- Avoid opening file picker dialogs or overlapping modals during the demo
- File names in editor tabs must be fully visible (not `auth/middle...`)
- If Hermes logs show `confidence < 0.6` frames: bump font size, ensure file tab is clear
- Terminal output must be on a single line — avoid long stack traces during demo

---

## Cooldown note

Hermes has a 3-minute cooldown between nudges per pod. For the demo, if you need to trigger a second event quickly:

Option 1: restart Hermes between the two demo scenarios (resets cooldown state)
Option 2: set `NUDGE_COOLDOWN_MS=0` via env var during demo (add this override to Hermes)

---

## Fallback plan

If any system fails on stage:

1. **Hermes unreachable:** switch to local (`pnpm --filter backend dev`) — PWA auto-falls back to `localhost:8787`
2. **Gemini Vision low confidence:** presenter narrates what PodMan "saw" while playing the backup video
3. **LiveKit audio not working:** play backup video — show the nudge text cards on screen instead
4. **Full system failure:** play the backup recording, narrate the demo live

Always have the backup video on a separate device, not the same laptop running Hermes.
