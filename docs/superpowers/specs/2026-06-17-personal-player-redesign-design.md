# Personal Player Redesign Design

## Goal

Redesign the personal YouTube Music Desktop experience around a larger main music workspace, selectable native player surfaces, selectable top bars, and mini-player behavior on close or minimize.

This is for personal use, not a public release. The design should preserve YouTube Music's core workflows: search, explore, library browsing, queue management, and playlist building.

AI integration is explicitly out of scope for this phase.

## Approved Scope

### Top Bar Layouts

Add a setting named `topBarLayout` with two options:

- `command`: a dense single-row top bar with icon-first controls.
- `twoLevel`: a larger-window top bar with app/window/player controls on the top row and search/explore/library/playlist controls on the second row.

The default should be `twoLevel`.

### Player Layouts

Add a setting named `playerLayout` with three options:

- `compactDock`: compact bottom player dock with artwork, metadata, progress, icon playback controls, quick actions, and a small VU meter.
- `expandedStrip`: richer now-playing strip with larger artwork/status, progress, playback controls, volume, quick actions, and a larger VU meter.
- `controlConsole`: power-user player surface with queue/session shortcuts and prominent stereo meters.

The default should be `expandedStrip`.

### Window Behavior

Add settings for close and minimize behavior:

- `closeAction`: `miniPlayer`, `tray`, or `quit`.
- `minimizeAction`: `miniPlayer` or `taskbar`.

Defaults:

- `closeAction`: `miniPlayer`
- `minimizeAction`: `miniPlayer`

When the app enters mini-player mode, the full main window should collapse into a small player window rather than disappearing. The mini-player must include artwork, metadata, play/pause, previous, next, a VU indicator, and a restore button that returns to the full main workspace.

## Architecture

Keep the existing embedded YouTube Music `BrowserView` as the primary content surface. The native Vue renderer should become a shell around that view:

- Title/top bar controls live in the Vue main window renderer.
- Player surfaces live in the Vue main window renderer.
- YouTube Music content remains in the `BrowserView`.
- Playback commands continue to route through the existing `remoteControl:execute` IPC path.
- Player state continues to come from `playerStateStore` and existing YTM preload events.

The main process remains responsible for window sizing, mini-player transitions, BrowserView bounds, and IPC authorization. Renderer components should request actions through narrow preload APIs instead of directly mutating arbitrary state.

## Components

### Main Window Shell

Create a main shell component that owns:

- current top bar layout;
- current player layout;
- whether the full workspace or mini-player surface is active;
- reserved content bounds for the YouTube Music `BrowserView`;
- responsive sizing for large and small windows.

### Top Bar Components

Create separate components for:

- `CommandTopBar`
- `TwoLevelTopBar`

Both should use icon-first controls with tooltips. Text should be reserved for the search field and labels that materially improve navigation. Controls should include home, search/focus search, player mode, meters, queue, settings, mini-player, maximize/restore, and close-to-player. Back and forward controls should be included when the YTM `webContents` can navigate backward or forward; otherwise they should render disabled.

### Player Components

Create separate components for:

- `CompactDockPlayer`
- `ExpandedStripPlayer`
- `ControlConsolePlayer`
- `MiniPlayer`
- shared icon button, progress bar, VU meter, and now-playing metadata primitives.

The three full player layouts should share playback command wiring and player-state formatting. They should differ only in layout density and visual emphasis.

### Settings

Add settings UI controls for:

- Top Bar Layout: Command, Two-Level.
- Player Layout: Compact Dock, Expanded Strip, Control Console.
- Close Action: Mini-player, Tray, Quit.
- Minimize Action: Mini-player, Taskbar.
- VU Meter: enabled/disabled.

Use the app's existing settings store pattern and add schema defaults.

## Data Flow

1. YTM preload observes playback and emits state changes to the main process.
2. Main process updates `playerStateStore`.
3. Main process broadcasts player state to the renderer shell.
4. Renderer shell passes normalized state into the selected player component.
5. Player component emits playback actions through preload methods.
6. Main process validates sender and forwards allowed commands to the YTM `BrowserView`.

Settings flow:

1. Settings window updates the persisted store.
2. Main process broadcasts settings changes.
3. Main renderer switches top bar and player components without restarting the app where possible.
4. Main process recalculates BrowserView bounds when player height or top bar height changes.

Mini-player flow:

1. Close/minimize event checks the configured action.
2. If mini-player is selected, main process switches to mini-player mode instead of quitting or hiding.
3. BrowserView is hidden or detached from the visible workspace while mini-player is active.
4. Restore button returns the full workspace, reattaches/resizes the BrowserView, and preserves playback state.

## VU Meter

The first implementation should prefer a lightweight meter based on available playback/audio state if reliable audio analysis is not immediately available. If Web Audio capture from YouTube Music is feasible without destabilizing playback, implement stereo amplitude metering behind a small abstraction. If audio capture is not feasible in the first implementation, render deterministic idle/animated levels and keep the `MeterSource` boundary ready for real audio levels later.

- `MeterSource`: receives or computes left/right levels.
- `VuMeter`: renders compact bars, expanded bars, or console meters.

The meter should fail closed: if audio levels are unavailable, show an idle meter state rather than crashing or blocking controls.

## Error Handling

- If playback state is missing, show placeholders and keep controls available.
- If the YTM view is unresponsive, top bar should expose reload/restore actions and show a clear status indicator.
- If mini-player transition fails, fall back to existing minimize/hide behavior and log the failure.
- If a setting contains an unknown value, fall back to defaults.
- If BrowserView bounds cannot be updated, log the failure and keep the last known layout.

## Testing

Add focused tests where the current project tooling supports them. At minimum, implementation should verify:

- settings defaults and migration behavior;
- top bar layout selection;
- player layout selection;
- close/minimize action decision logic;
- mini-player restore flow;
- playback command routing from player controls;
- BrowserView bounds calculations for each top bar/player layout combination;
- renderer behavior when player state is missing or partial.

Manual verification should cover:

- search and playlist workflows remain usable in the full main window;
- each top bar layout works at the larger target window size;
- each player layout is selectable without restart;
- close and minimize enter mini-player mode;
- restore returns to the full main workspace;
- tray behavior still works when selected explicitly.

## Non-Goals

- AI chat or AI app control.
- Beatmixing, DJ queue generation, audio effects, compression, EQ, or limiter processing.
- Public release polish, packaging changes, or public documentation updates.
- Replacing YouTube Music's own search, library, playlist, or queue experience.
