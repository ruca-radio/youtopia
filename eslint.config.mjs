import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import vuePlugin from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";

const tsRecommended = tsPlugin.configs.recommended?.rules ?? {};
const vueRecommended = vuePlugin.configs["vue3-recommended"]?.rules ?? vuePlugin.configs["flat/recommended"]?.rules ?? {};
const importRules = {
  ...(importPlugin.configs.recommended?.rules ?? {}),
  ...(importPlugin.configs.electron?.rules ?? {}),
  ...(importPlugin.configs.typescript?.rules ?? {})
};

export default [
  {
    ignores: ["out/**", ".vite/**", ".yarn/**", "node_modules/**", "firetv-receiver/build/**", "src/assets/flash-ui-dist/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs,ts,tsx,vue}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        __dirname: "readonly",
        Buffer: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        global: "readonly",
        module: "readonly",
        NodeJS: "readonly",
        process: "readonly",
        require: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        window: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      vue: vuePlugin,
      import: importPlugin
    },
    rules: {
      ...tsRecommended,
      ...importRules,
      "vue/multi-word-component-names": "off",
      "import/no-unresolved": "off",
      "no-useless-assignment": "off"
    },
    settings: {
      "import/resolver": {
        typescript: {}
      }
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "no-undef": "off"
    }
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: {
          js: "espree",
          ts: tsParser,
          "<template>": "espree"
        },
        sourceType: "module"
      }
    },
    rules: {
      ...vueRecommended,
      "no-undef": "off"
    }
  },
  {
    files: ["src/renderer/ytmview/scripts/**/*.js", "src/main/integrations/volume-ratio/script/**/*.js"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty": "off",
      "no-undef": "off"
    }
  },
  prettier
];
