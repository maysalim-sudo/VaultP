// Metro, configured for the workspace.
//
// Two adjustments are needed beyond the Expo default:
//
//   1. Metro must watch and resolve into the repo root, or `@vaultp/core` — which
//      lives outside this app's folder — is invisible to the bundler.
//   2. `core` is written as real ESM and imports siblings as './money.js'. Node
//      and Vitest resolve that correctly; Metro does not, and would look for a
//      literal .js file that was never emitted. The hook below retries such a
//      specifier without the extension so the TypeScript source is found.
//
// The alternative is compiling `core` to JavaScript before every run, which costs
// a build step on every edit and makes stack traces point at generated code.

const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch only what can actually change: this app, and the shared package.
//
// Watching the whole repo root looked simpler and cost 80+ seconds per rebuild —
// Metro was re-crawling every node_modules tree and the entire Gradle build
// output on each edit. Resolution still reaches the root via nodeModulesPaths
// below; watching and resolving are separate concerns.
config.watchFolders = [path.resolve(workspaceRoot, 'packages/core')];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Without this, Metro walks up the tree and can load two copies of React.
config.resolver.disableHierarchicalLookup = true;

// Build artefacts churn constantly and are never part of a bundle. Left in, they
// wake the file watcher on every Gradle run.
config.resolver.blockList = [
  /[\\/]android[\\/](build|\.cxx|\.gradle)[\\/].*/,
  /[\\/]\.git[\\/].*/,
];

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;

  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName.replace(/\.js$/, ''), platform);
    } catch {
      // Fall through: it really was a .js file.
    }
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
