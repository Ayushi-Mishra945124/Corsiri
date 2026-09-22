# Corsiri Companion (WPF)

## Purpose

Act as the central runtime for selection detection, UI overlays, and backend orchestration.

## MVP Responsibilities

- Provide mock `MX Trigger` test entrypoint
- Capture selected text from active window
- Show orb status near cursor
- Send text/image context to backend for action execution
- Copy result to clipboard
- Show expandable result panel
- Keep trigger parity with tap / long press / dial tick / dial press

## Extended Responsibilities (Implemented)

- Smart + Guided modes with first-run onboarding selection
- Guided action menu with AI suggestion and custom voice-command option
- Lasso screenshot mode and pixel HEX fallback on cancel
- Long-press hold-to-talk voice capture with Nova transcription
- Optional Nova 2 Sonic realtime voice command path with fallback to buffered transcription
- Optional streaming-style partial transcription while holding (faster long prompts)
- Text selection flow can attach a nearby screenshot context so text + image are sent together when useful
- Intent memory persistence for action ranking
- Hybrid output mode (always copy, optional Smart auto-replace for safe high-confidence actions)
- Post-result `Take Action` trigger that turns the last AI output into a real browser action plan and executes it through the local Playwright browser agent
- Chromium extension + native messaging host path so `Take Action` can operate inside the user's real logged-in browser tab first
- Take Action preview window + Undo support for browser/app actions

## Status

Implemented runnable companion app in `src/Corsiri.Companion` (compiles as `Corsiri.Companion`).

## Run

1. Ensure backend is running at `http://127.0.0.1:8080` or set `CORSIRI_BACKEND_URL` / `CURSIVIS_BACKEND_URL`.
2. Ensure browser action agent is running at `http://127.0.0.1:48820` for managed-browser `Take Action` fallback.
3. If you want `Take Action` in your real logged-in Chromium-family browser tabs, load the unpacked extension from [desktop/browser-extension-chromium/README.md](../browser-extension-chromium/README.md) and register the native host:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-browser-bridge.ps1 -ExtensionId "<EXTENSION_ID>"
```

4. Start the companion:

```powershell
cd desktop/corsiri-companion/src/Corsiri.Companion
dotnet run
```

5. Demo flow:
- Select text in an external app.
- Click `Trigger` in `MX Creative Console Demo`.
- Orb (top-right, draggable) shows processing.
- Result is copied to clipboard and shown in result panel.
- Hold `Hold to Talk`, speak, and release to send.
- Switch Smart/Guided mode from the panel dropdown.
- Use `More Options` on result panel to re-run with a different action.
- Use `Take Action` on result panel to let Nova plan live browser steps from the current page and execute them in your real current browser tab first, then fall back to the managed Corsiri browser session if needed.
- Use `Undo` on result panel to send a safe Ctrl+Z-style rollback to the last app/browser action when supported.
- Use `Exit` in the demo panel for quick shutdown.

No-text flow:

- Trigger opens lasso selection overlay.
- Drag and release a region to analyze screenshot content.
- If canceled, pixel color under cursor is copied as HEX.

IPC trigger endpoint:

- WebSocket: `ws://127.0.0.1:48711/corsiri-trigger/` (with fallback `ws://127.0.0.1:48711/cursivis-trigger/`)
- Haptics channel: `ws://127.0.0.1:48712/corsiri-haptics/` (with fallback `ws://127.0.0.1:48712/cursivis-haptics/`)

External trigger source:

- Run the Logitech bridge console in `plugin/logitech-plugin/src/Cursivis.Logitech.Bridge`.

Companion env flags (supports both `CORSIRI_*` and legacy `CURSIVIS_*`):

- `CORSIRI_ENABLE_STREAMING_TRANSCRIPTION=true|false`
- `CORSIRI_ENABLE_TEXT_SCREEN_CONTEXT=true|false`
- `CORSIRI_TEXT_SCREEN_CONTEXT_WIDTH=480`
- `CORSIRI_TEXT_SCREEN_CONTEXT_HEIGHT=320`
- `CORSIRI_MAX_VOICE_SECONDS=45`
- `CORSIRI_STREAM_PROBE_SECONDS=2`
- `CORSIRI_VOICE_CONFIRM=true|false` (if `false`, accepted transcript is auto-used without edit dialog)
- `CORSIRI_ENABLE_AUTO_REPLACE=true|false`
- `CORSIRI_AUTO_REPLACE_CONFIDENCE=0.90`
- `CORSIRI_ENABLE_AUTO_TAKE_ACTION=true|false`
- `CORSIRI_ENABLE_VOICE_ACTION_HANDOFF=true|false`
- `CORSIRI_ENABLE_LIVE_API_VOICE=true|false`
- `CORSIRI_BROWSER_AGENT_URL=http://127.0.0.1:48820`
- `CORSIRI_EXTENSION_BRIDGE_URL=http://127.0.0.1:48830`
