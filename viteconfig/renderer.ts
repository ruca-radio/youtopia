import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { execSync } from "node:child_process";

let gitBranch: string = "";
let gitCommitHash: string = "";
try {
  gitBranch = execSync("git rev-parse --abbrev-ref HEAD").toString();
  gitCommitHash = execSync("git rev-parse HEAD").toString();
} catch (e) {
  e.message =
    " ======= Failed to get Git Info. ======= \n" +
    "Please make sure that when building this application you are cloning the repository from GitHub rather than using the Download ZIP option.\n" +
    "Follow the instructions in the README.md file to clone the repository and build the application from there.\n" +
    " ======= Failed to get Git Info. ======= \n\n" +
    e.message;
  throw e;
}

export default defineConfig({
  root: "src/renderer",
  build: {
    outDir: "../../.vite/renderer",
    rollupOptions: {
      input: {
        main_window: "src/renderer/windows/main/index.html",
        settings_window: "src/renderer/windows/settings/index.html",
        authorize_companion_window: "src/renderer/windows/authorize-companion/index.html"
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/vue")) {
            return "vue";
          }
        }
      }
    }
  },
  plugins: [
    vue({
      features: {
        optionsAPI: false
      }
    })
  ],
  resolve: {
    alias: {
      "~shared": path.resolve(__dirname, "../src/shared"),
      "~assets": path.resolve(__dirname, "../src/assets")
    }
  },
  define: {
    YTMD_GIT_COMMIT_HASH: JSON.stringify(gitCommitHash),
    YTMD_GIT_BRANCH: JSON.stringify(gitBranch)
  }
});
