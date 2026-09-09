# Inspector UI contract

## Scope and user task

This contract covers the existing React Page Inspector, including its inert companion tab.
It is a refinement of the VS Code-native developer tool, not a new visual identity.
The primary task is to select a rendered component, understand its state, and take a safe next step.

## Information hierarchy

- Keep **Pick on page** and **Current file** immediately available.
- Group display overlays, hide/undo, export remount, and placement under **View & tools**.
- Keep automatic recovery status, pause/resume, and actionable choices in their own region.
- Show authored page identity and the real rendering status before technical path evidence.
- Put path alternatives, rendering perspective, and routes under **Paths & rendering**.
- Preserve four workbench identities and the saved active tab: Conditions, Components, Details, Console.
- Do not remove manual controls or imply verified success without renderer evidence.

## Visual language

- Use the existing `--vscode-*` colors and `--rpi-border` / `--rpi-muted` aliases.
- Retain the editor font for code and paths; use the VS Code UI font for controls and descriptions.
- Keep compact 11–13px type, 4/8/12px spacing, and existing 3px control radii.
- Use the primary button color for picking; status colors describe state, not decoration.
- Prefer plain grouped rows and native disclosures over nested cards or new icon systems.
- No new fonts, dependencies, or decorative animation; retain reduced-motion handling.

## Interaction and responsive behavior

- Disclosures must work with pointer, Enter, and Space in both the source and companion.
- Inference review opens its containing disclosure before focusing the evidence.
- Give selects visible labels and maintain native disabled, pressed, expanded, and focus states.
- Do not remount the authored page or resubscribe the tree for learning-progress updates.
- Preserve scroll, selected tab, manual choices, layout, and existing learning data.
- At 390px, all four tab labels remain discoverable and controls wrap without page overflow.
- Bound secondary-region scrolling so the workbench stays reachable on compact displays.
- Dense tables may scroll within their own viewport; preserve their table semantics in the mirror.

## Acceptance checks

- Production preview → companion: pick/current-file navigation, tabs, search, display toggles,
  disclosures, inference review, keyboard operation, and console empty state.
- Visually inspect 390×844, 768×1024, and 1440×900; check dark/light and long-content states.
- Keep ready, pending, blocked/error, empty, disabled, pressed, and focus states distinguishable.
- Functional tests and actual browser screenshots are separate checks.
- Keep executable markup, arbitrary resource attributes, and workspace script execution blocked.
