const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Monorepo support: let Metro see the entire repo and resolve
// workspace packages, while forcing a single copy of react/react-native
// to avoid the "invalid hook call" duplicate-React error.
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  react: path.resolve(monorepoRoot, "node_modules/react"),
  "react-native": path.resolve(monorepoRoot, "node_modules/react-native"),
};

// Expo Go ships native worklets 0.5.1, but reanimated 4.x depends on
// worklets 0.7.x. Force Metro to resolve the Expo Go-compatible local
// copy (installed via `npx expo install react-native-worklets`).
const localWorklets = path.resolve(projectRoot, "node_modules/react-native-worklets");
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-worklets" || moduleName.startsWith("react-native-worklets/")) {
    const redirected = moduleName.replace("react-native-worklets", localWorklets);
    return (defaultResolve || context.resolveRequest)(context, redirected, platform);
  }
  return (defaultResolve || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
