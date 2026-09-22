# Demo Scenarios

## Scenario 1: Smart Text Summary (Required MVP)

1. User selects text in browser or editor.
2. User triggers `MX Trigger` (mock panel).
3. Orb appears near cursor and shows processing.
4. Result auto-copies to clipboard.
5. Expand panel reveals full summary.

Success criteria:

- End-to-end flow uses real Nova response.

## Scenario 2: Guided Text Actions

1. User selects text.
2. Trigger in Guided mode.
3. Menu offers ranked actions.
4. User picks `Translate` (or any action).
5. Result appears and copies.

## Scenario 3: No-Text Lasso

1. User triggers with no text selected.
2. Lasso capture opens and user draws region.
3. Image sent to backend.
4. Nova returns caption/analysis.

## Scenario 4: Pixel Color Fallback

1. User triggers with no text selected.
2. User cancels lasso.
3. System samples pixel under cursor.
4. Hex value copied and shown in orb confirmation.

## Scenario 5: Long-Press Voice Command

1. User selects text.
2. Long-press trigger.
3. Voice command captured.
4. Backend receives context + transcript.
5. Transformed output returned and displayed.
