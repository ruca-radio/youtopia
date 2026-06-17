# Youtopia Player Shell Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first working slice of the Youtopia personal player redesign: persisted layout settings, selectable top bar/player shell components, and placeholder-safe native controls.

**Architecture:** Keep the existing YouTube Music `BrowserView` as the primary content. Add a Vue shell around it with selectable top bar and player components driven by the existing settings store. Route playback commands through existing preload IPC methods and avoid mini-player window behavior in this slice.

**Tech Stack:** Electron Forge, Vue 3, Vite, TypeScript, Conf settings store, existing IPC/preload bridge.

---

## File Structure

- Modify `src/shared/store/schema.ts`: add enums and store fields for top bar layout, player layout, close/minimize behavior, and VU toggle.
- Modify `src/main/index.ts`: add settings defaults and broadcast settings changes to the main renderer.
- Modify `src/renderer/windows/settings/Settings.vue`: expose the new settings using existing `YTMDSetting` select/toggle controls.
- Modify `src/renderer/windows/main/preload.ts`: expose native player command helpers.
- Modify `src/renderer/@types/global.d.ts`: type the new preload helpers.
- Modify `src/renderer/windows/main/Index.vue`: replace the bare title/loading shell with a selectable shell.
- Create `src/renderer/windows/main/player-shell/types.ts`: shared layout and player state display types.
- Create `src/renderer/windows/main/player-shell/IconButton.vue`: reusable icon button.
- Create `src/renderer/windows/main/player-shell/VuMeter.vue`: deterministic placeholder VU meter component.
- Create `src/renderer/windows/main/player-shell/PlayerProgress.vue`: reusable progress bar.
- Create `src/renderer/windows/main/player-shell/NowPlayingInfo.vue`: placeholder-safe metadata block.
- Create `src/renderer/windows/main/player-shell/CommandTopBar.vue`: dense icon-first top bar.
- Create `src/renderer/windows/main/player-shell/TwoLevelTopBar.vue`: two-level top bar.
- Create `src/renderer/windows/main/player-shell/CompactDockPlayer.vue`: compact dock layout.
- Create `src/renderer/windows/main/player-shell/ExpandedStripPlayer.vue`: expanded strip layout.
- Create `src/renderer/windows/main/player-shell/ControlConsolePlayer.vue`: control console layout.
- Create `scripts/verify-player-shell.mjs`: source-level verification script for first-slice settings and component wiring.
- Modify `package.json`: add `verify:player-shell` script.

## Tasks

### Task 1: Add Verification Script

**Files:**
- Create: `scripts/verify-player-shell.mjs`
- Modify: `package.json`

- [ ] Create `scripts/verify-player-shell.mjs` that asserts the planned enum names, settings defaults, component files, and settings controls are present.
- [ ] Run `node scripts/verify-player-shell.mjs` and verify it fails before implementation because the new enums/components do not exist.

### Task 2: Add Settings Schema And Defaults

**Files:**
- Modify: `src/shared/store/schema.ts`
- Modify: `src/main/index.ts`

- [ ] Add `TopBarLayout`, `PlayerLayout`, `CloseAction`, and `MinimizeAction` enums.
- [ ] Add `appearance.topBarLayout`, `appearance.playerLayout`, and `appearance.vuMeterEnabled`.
- [ ] Add `general.closeAction` and `general.minimizeAction`.
- [ ] Add matching Conf defaults:
  - `topBarLayout`: `TopBarLayout.TwoLevel`
  - `playerLayout`: `PlayerLayout.ExpandedStrip`
  - `vuMeterEnabled`: `true`
  - `closeAction`: `CloseAction.MiniPlayer`
  - `minimizeAction`: `MinimizeAction.MiniPlayer`
- [ ] Broadcast settings changes to `mainWindow` as well as settings and YTM renderers.
- [ ] Run `node scripts/verify-player-shell.mjs` and verify it still fails because UI/components are not complete.

### Task 3: Add Settings UI

**Files:**
- Modify: `src/renderer/windows/settings/Settings.vue`

- [ ] Import the new enums.
- [ ] Add refs for top bar layout, player layout, close action, minimize action, and VU meter toggle.
- [ ] Keep refs in sync in `store.onDidAnyChange`.
- [ ] Persist the new fields in `settingsChanged`.
- [ ] Add select/toggle controls to General and Appearance tabs.
- [ ] Run `node scripts/verify-player-shell.mjs` and verify it still fails because shell components are not complete.

### Task 4: Add Main Shell Components

**Files:**
- Create the `src/renderer/windows/main/player-shell/*` files listed above.
- Modify `src/renderer/windows/main/preload.ts`
- Modify `src/renderer/@types/global.d.ts`
- Modify `src/renderer/windows/main/Index.vue`

- [ ] Add preload helpers for `playPause`, `previous`, `next`, `toggleLike`, `toggleDislike`, `volumeUp`, `volumeDown`, `openMiniPlayer`, and `focusSearch`.
- [ ] Build the top bar components with icon-first controls and tooltips.
- [ ] Build the three player layout components with placeholder-safe metadata and deterministic VU levels.
- [ ] Update `Index.vue` to select top bar/player component from settings and pass command handlers.
- [ ] Keep `YTMViewLoading` in place so existing load state still renders.
- [ ] Run `node scripts/verify-player-shell.mjs` and verify it passes.

### Task 5: Verify And Commit

**Files:** all modified files.

- [ ] Run `yarn lint`. Expected: pass with the existing two warnings only.
- [ ] Run `yarn package`. Expected: pass and produce a Youtopia package.
- [ ] Run `git status --short` and review changed files.
- [ ] Commit with `feat: add selectable player shell`.
