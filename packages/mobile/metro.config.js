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

// Force react-native-worklets to resolve to the Expo Go-compatible version
// (0.5.1 local) instead of the hoisted root version (0.7.4). In a monorepo,
// reanimated at root imports worklets relative to itself, bypassing
// nodeModulesPaths order. resolveRequest intercepts ALL resolution.
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
