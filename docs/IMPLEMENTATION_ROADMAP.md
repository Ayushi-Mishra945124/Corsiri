# Implementation Roadmap

## Milestone A: Vertical Slice (Immediate)

Goal:

- Run a complete text flow using mock trigger and real Nova response.

Deliver:

- Companion WPF shell with mock trigger button
- Text selection detection via clipboard capture strategy
- Orb state machine (`Idle -> Processing -> Completed/Error`)
- Backend `/api/intent` summarize endpoint
- Clipboard write + expandable result panel

## Milestone B: Guided Mode

Goal:

- Add manual action choice with dynamic options.

Deliver:

- Guided options UI near orb
- Backend suggestion endpoint behavior
- action override in smart flow (`More options`)

## Milestone C: Multimodal

Goal:

- Add no-text workflows.

Deliver:

- Lasso region capture overlay
- image payload to backend for Nova analysis
- pixel hex fallback when lasso is canceled

## Milestone D: Logitech Integration

Goal:

- Replace mock trigger with real Logitech device events.

Deliver:

- Logi Actions SDK plugin action(s)
- Local IPC event sender
- Optional haptic feedback bindings

## Milestone E: Voice + Memory

Goal:

- Enable long-press voice commands and personalization.

Deliver:

- long-press capture pipeline
- speech-to-text integration
- local intent memory ranking

## Milestone F: Demo Hardening

Goal:

- Stable competition demo runtime.

Deliver:

- startup scripts
- crash recovery paths
- latency and reliability telemetry
- polished UX and scripted demo paths
