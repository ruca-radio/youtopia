import fs from "fs";
import path from "path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertIncludes(file, text) {
  const content = read(file);
  if (!content.includes(text)) {
    throw new Error(`${file} does not include ${JSON.stringify(text)}`);
  }
}

function assertFile(file) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`${file} does not exist`);
  }
}

const schema = "src/shared/store/schema.ts";
assertIncludes(schema, "export enum TopBarLayout");
assertIncludes(schema, "export enum PlayerLayout");
assertIncludes(schema, "export enum CloseAction");
assertIncludes(schema, "export enum MinimizeAction");
assertIncludes(schema, "topBarLayout: TopBarLayout;");
assertIncludes(schema, "playerLayout: PlayerLayout;");
assertIncludes(schema, "vuMeterEnabled: boolean;");
assertIncludes(schema, "closeAction: CloseAction;");
assertIncludes(schema, "minimizeAction: MinimizeAction;");

const main = "src/main/index.ts";
assertIncludes(main, "topBarLayout: TopBarLayout.TwoLevel");
assertIncludes(main, "playerLayout: PlayerLayout.ExpandedStrip");
assertIncludes(main, "vuMeterEnabled: true");
assertIncludes(main, "closeAction: CloseAction.MiniPlayer");
assertIncludes(main, "minimizeAction: MinimizeAction.MiniPlayer");
assertIncludes(main, 'mainWindow.webContents.send("settings:stateChanged", newState, oldState);');

const settings = "src/renderer/windows/settings/Settings.vue";
assertIncludes(settings, "TopBarLayout");
assertIncludes(settings, "PlayerLayout");
assertIncludes(settings, "CloseAction");
assertIncludes(settings, "MinimizeAction");
assertIncludes(settings, "topBarLayout");
assertIncludes(settings, "playerLayout");
assertIncludes(settings, "vuMeterEnabled");
assertIncludes(settings, "closeAction");
assertIncludes(settings, "minimizeAction");

const components = [
  "src/renderer/windows/main/player-shell/types.ts",
  "src/renderer/windows/main/player-shell/IconButton.vue",
  "src/renderer/windows/main/player-shell/VuMeter.vue",
  "src/renderer/windows/main/player-shell/PlayerProgress.vue",
  "src/renderer/windows/main/player-shell/NowPlayingInfo.vue",
  "src/renderer/windows/main/player-shell/CommandTopBar.vue",
  "src/renderer/windows/main/player-shell/TwoLevelTopBar.vue",
  "src/renderer/windows/main/player-shell/CompactDockPlayer.vue",
  "src/renderer/windows/main/player-shell/ExpandedStripPlayer.vue",
  "src/renderer/windows/main/player-shell/ControlConsolePlayer.vue"
];

for (const component of components) {
  assertFile(component);
}

const preload = "src/renderer/windows/main/preload.ts";
assertIncludes(preload, "playerControl");
assertIncludes(preload, "openMiniPlayer");
assertIncludes(preload, "focusSearch");

console.log("Player shell verification passed");
