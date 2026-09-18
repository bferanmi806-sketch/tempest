import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, realpathSync } from 'fs'
import { join, dirname, relative, sep } from 'path'
import { fileURLToPath } from 'url'
import { pruneCruft } from './prune-bundle.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rootModules = join(root, 'node_modules')
const src = join(rootModules, '@usetempest', 'atlas')
const dest = join(root, 'src-tauri', 'resources', 'atlas')
const destModules = join(dest, 'node_modules')

if (!existsSync(src)) process.exit(0)

// Runtime files the staged bundle must contain, relative to the Atlas
// package root. These mirror the paths the Rust backend resolves at
// runtime (dist/mcp/server-entry.js) plus the assets its loader needs
// alongside the entry point. Checked before staging (fail fast on a bad
// source tree) and again after pruning (fail fast on a bad prune), so a
// broken bundle can never silently reach the installer.
const REQUIRED_RUNTIME_FILES = [
  join('dist', 'mcp', 'server-entry.js'),
  join('dist', 'index.js'),
  join('dist', 'db', 'schema.sql'),
]
const REQUIRED_RUNTIME_PACKAGES = ['@usetempest/atlas', '@xenova/transformers', 'onnxruntime-node']

function fail(message) {
  console.error(`[install-atlas] ERROR: ${message}`)
  process.exit(1)
}

/** True when `dir` holds at least one .wasm runtime asset. */
function hasWasmAssets(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (hasWasmAssets(full)) return true
    } else if (entry.name.endsWith('.wasm')) {
      return true
    }
  }
  return false
}

/**
 * Assert the resolved Atlas source is a real published package — not a
 * symlink/junction back to the local packages/atlas checkout (which has no
 * committed dist/ and is never built by root `npm ci`) — and that its
 * compiled entry points exist. Exits non-zero otherwise.
 */
function verifySource() {
  const srcReal = realpathSync(src)
  const rel = relative(root, srcReal)
  if (rel === join('packages', 'atlas') || rel.startsWith(join('packages', 'atlas') + sep)) {
    fail(
      `node_modules/@usetempest/atlas resolves to the local source checkout (${srcReal}), ` +
        `which ships no dist/. The root package-lock.json must resolve @usetempest/atlas from ` +
        `the npm registry (see issue #117); regenerate it and reinstall.`,
    )
  }
  const missing = REQUIRED_RUNTIME_FILES.filter((relPath) => !existsSync(join(srcReal, relPath)))
  if (missing.length > 0) {
    fail(
      `Atlas source is missing compiled output: ${missing.join(', ')} (resolved from ${srcReal}). ` +
        `The published @usetempest/atlas package must contain dist/; refusing to stage a bundle ` +
        `with no MCP entry point.`,
    )
  }
  if (!hasWasmAssets(join(srcReal, 'dist', 'extraction', 'wasm'))) {
    fail(
      `Atlas source has no .wasm assets under dist/extraction/wasm (resolved from ${srcReal}). ` +
        `Refusing to stage a bundle that cannot run extraction.`,
    )
  }
}

/**
 * Assert the staged (and pruned) bundle still contains every runtime file
 * and package the app needs. Exits non-zero on the first gap.
 */
function verifyStaged() {
  const atlasRoot = join(destModules, '@usetempest', 'atlas')
  const missingFiles = REQUIRED_RUNTIME_FILES.filter(
    (relPath) => !existsSync(join(atlasRoot, relPath)),
  )
  if (missingFiles.length > 0) {
    fail(
      `staged Atlas bundle is missing runtime files: ${missingFiles.join(', ')}. ` +
        `Staging or pruning dropped them; refusing to leave a broken bundle behind.`,
    )
  }
  if (!hasWasmAssets(join(atlasRoot, 'dist', 'extraction', 'wasm'))) {
    fail('staged Atlas bundle has no .wasm assets under dist/extraction/wasm; pruning must not remove them.')
  }
  const missingPackages = REQUIRED_RUNTIME_PACKAGES.filter(
    (pkg) => !existsSync(join(destModules, ...pkg.split('/'), 'package.json')),
  )
  if (missingPackages.length > 0) {
    fail(`staged Atlas bundle is missing runtime packages: ${missingPackages.join(', ')}.`)
  }
}

verifySource()

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

// Pin to CommonJS so Node doesn't inherit the root package.json "type": "module"
writeFileSync(
  join(dest, 'package.json'),
  JSON.stringify({ name: '@tempest/atlas-runtime', private: true, type: 'commonjs' }, null, 2) + '\n'
)

// Copy the transitive closure of every dep the shipped Atlas needs at runtime.
// npm hoists deps to the *root* node_modules and we only cpSync'd the Atlas
// package itself above — so in the installer (no parent tree to walk up into)
// `require('picomatch')` / `require('web-tree-sitter')` / `@xenova/transformers`
// all fail. In `tauri dev` this happened to work because Node walked up out of
// resources/atlas/ into the repo's real node_modules; in production there is
// no parent, which is why installed Atlas MCP has silently failed to boot.
//
// onnxruntime-node MUST be included: @xenova/transformers' backends/onnx.js
// does a static ESM `import * as ONNX_NODE from 'onnxruntime-node'`, so a
// missing package throws ERR_MODULE_NOT_FOUND at module-load time — there is
// no runtime WASM fallback in v2.x. `sharp` (image codec) is excluded — text
// embedding never touches it. Model weights are NOT bundled: they download on
// user consent at runtime into the app-data cache.
const BUNDLE_ROOTS = ['@usetempest/atlas', '@xenova/transformers']
const EXCLUDE = new Set(['sharp'])

/** Copy `pkg` from root node_modules → dest, then recurse into its deps. */
function copyClosure(pkg, seen = new Set()) {
  if (seen.has(pkg) || EXCLUDE.has(pkg)) return
  seen.add(pkg)
  const from = join(rootModules, ...pkg.split('/'))
  const pkgJson = join(from, 'package.json')
  if (!existsSync(pkgJson)) {
    console.warn(`[install-atlas] WARN: dependency not found in root node_modules: ${pkg}`)
    return
  }
  cpSync(from, join(destModules, ...pkg.split('/')), { recursive: true, dereference: true })
  let meta
  try { meta = JSON.parse(readFileSync(pkgJson, 'utf8')) } catch { return }
  // Walk both `dependencies` and `optionalDependencies` — @xenova/transformers
  // declares `onnxruntime-node` as OPTIONAL, but its backends/onnx.js does a
  // hard static import of it, so we still need it bundled.
  const deps = { ...(meta.dependencies ?? {}), ...(meta.optionalDependencies ?? {}) }
  for (const dep of Object.keys(deps)) copyClosure(dep, seen)
}

for (const pkg of BUNDLE_ROOTS) copyClosure(pkg)

// onnxruntime-node ships prebuilt native binaries for every platform under
// bin/napi-v3/{darwin,linux,win32}/{arch}/. Each build only needs its own —
// keeping the other two adds ~70MB of dead weight to every installer.
// ponytail: prunes by process.platform of the build machine; per-platform CI
// already runs this script per target, so each installer gets exactly one.
const ORT_PLATFORMS = ['darwin', 'linux', 'win32']
const ORT_ARCHES = ['x64', 'arm64', 'ia32']
const ortBin = join(destModules, 'onnxruntime-node', 'bin', 'napi-v3')
if (existsSync(ortBin)) {
  for (const p of ORT_PLATFORMS) {
    if (p !== process.platform) {
      rmSync(join(ortBin, p), { recursive: true, force: true })
    }
  }
  // Also prune sibling archs of the current platform (win32/arm64 alongside
  // win32/x64 etc). ~9MB per unused arch on Windows.
  const platDir = join(ortBin, process.platform)
  if (existsSync(platDir)) {
    for (const a of ORT_ARCHES) {
      if (a !== process.arch) {
        rmSync(join(platDir, a), { recursive: true, force: true })
      }
    }
  }
}

// @usetempest/atlas ships src/ AND dist/ — dist/ is the runtime entry (see
// package.json `main`), src/ is TS + duplicate wasm + schema.sql (all mirrored
// into dist/ by the package's copy-assets step). Only .map files reference
// ../src/ and those get pruned right below. Saves ~30MB.
const atlasSrc = join(destModules, '@usetempest', 'atlas', 'src')
if (existsSync(atlasSrc)) rmSync(atlasSrc, { recursive: true, force: true })

// Generic cruft prune: .map, .md, .d.ts, test/, docs/, examples/, CI files.
// Runtime is byte-identical.
const bytesPruned = pruneCruft(destModules)
if (bytesPruned > 0) {
  const mb = (bytesPruned / 1024 / 1024).toFixed(1)
  console.log(`[install-atlas] pruned ${mb} MB of cruft`)
}

// `sharp` is npm-nested inside @xenova/transformers (not hoisted) so the
// recursive cpSync copies it in — but its transitive deps (`detect-libc`, etc.)
// live at the root and were never followed, so `require('detect-libc')` throws
// at sharp's module-load. Transformers does `import sharp from 'sharp'` at the
// top of utils/image.js and then, at module scope, either uses it (else if
// (sharp)) or throws "Unable to load image processing library" — text
// embedding never touches images, but the throw fires at IMPORT time even so.
// Replace the nested sharp with a truthy, self-chaining Proxy stub: the guard
// passes, function bodies are only defined not executed, and any incidental
// `sharp(...)` / `sharp.x.y()` access resolves to another no-op instead of
// crashing. Avoids libvips native binaries and sharp's transitive closure.
const sharpNested = join(destModules, '@xenova', 'transformers', 'node_modules', 'sharp')
if (existsSync(sharpNested)) {
  rmSync(sharpNested, { recursive: true, force: true })
  mkdirSync(sharpNested, { recursive: true })
  writeFileSync(
    join(sharpNested, 'package.json'),
    JSON.stringify({ name: 'sharp', version: '0.0.0-stub', main: 'index.js' }, null, 2) + '\n'
  )
  writeFileSync(
    join(sharpNested, 'index.js'),
    'const stub = new Proxy(function () { return stub; }, { get: () => stub });\n' +
      'module.exports = stub;\n' +
      'module.exports.default = stub;\n'
  )
}

verifyStaged()

console.log('Atlas staged → src-tauri/resources/atlas/')
