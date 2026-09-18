// Self-check for the Atlas release contract (issue #117).
// The Windows NSIS installer once shipped an Atlas tree with no
// dist/mcp/server-entry.js because node_modules/@usetempest/atlas had
// silently become a local link to packages/atlas (which ships no dist/),
// and install-atlas.mjs staged it without verifying anything.
// Run with `node src/atlas/atlas-release.check.ts`.
import assert from "node:assert";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const isLocalAtlasLink = (real: string): boolean => {
  const rel = relative(root, real);
  return rel === join("packages", "atlas") || rel.startsWith(join("packages", "atlas") + sep);
};

// ── the lockfile must resolve Atlas from the registry, never link it ──
// Install-independent: catches the regression even before `npm ci` runs.
const lock = readJson(join(root, "package-lock.json"));
const lockedAtlas = lock.packages?.["node_modules/@usetempest/atlas"];
assert.ok(lockedAtlas, "package-lock.json must pin node_modules/@usetempest/atlas");
assert.notStrictEqual(
  lockedAtlas.link,
  true,
  "package-lock.json must not link @usetempest/atlas to the local checkout " +
    "(it resolves to unbuilt packages/atlas with no dist/; see issue #117)",
);
assert.match(
  String(lockedAtlas.resolved ?? ""),
  /^https:\/\/registry\.npmjs\.org\//,
  "locked @usetempest/atlas must resolve to a registry tarball",
);
assert.ok(
  !lock.packages?.["packages/atlas"],
  "package-lock.json must not carry a packages/atlas workspace entry (it is not a workspace)",
);

// ── the Atlas source package must not depend on itself ──
// A self-dependency serves no purpose (no source file imports it) and only
// confuses the staged closure walk on the next publish.
const atlasManifest = readJson(join(root, "packages", "atlas", "package.json"));
for (const field of ["dependencies", "peerDependencies", "optionalDependencies"] as const) {
  assert.ok(
    !(atlasManifest[field]?.["@usetempest/atlas"] != null),
    `packages/atlas/package.json must not list @usetempest/atlas under ${field}`,
  );
}

// ── live install tree: Atlas must be a real package with compiled output ──
// Skipped (not failed) when node_modules is absent, so the check stays green
// on partial checkouts; install-atlas.mjs enforces this hard during `npm ci`.
const installedAtlas = join(root, "node_modules", "@usetempest", "atlas");
if (!existsSync(installedAtlas)) {
  console.log("atlas-release.check.ts — node_modules absent, live-tree assertions skipped");
} else {
  const real = realpathSync(installedAtlas);
  const stat = lstatSync(installedAtlas);
  assert.ok(
    !(stat.isSymbolicLink() && isLocalAtlasLink(real)),
    `node_modules/@usetempest/atlas must not resolve to the local checkout (got ${real})`,
  );
  assert.ok(
    existsSync(join(real, "dist", "mcp", "server-entry.js")),
    `resolved Atlas package is missing dist/mcp/server-entry.js (${real})`,
  );
}

// ── live staged bundle: pruning must not eat runtime assets ──
// Same skip rule: enforced hard by install-atlas.mjs whenever staging runs.
const stagedAtlas = join(
  root,
  "src-tauri",
  "resources",
  "atlas",
  "node_modules",
  "@usetempest",
  "atlas",
);
if (!existsSync(stagedAtlas)) {
  console.log("atlas-release.check.ts — staged bundle absent, bundle assertions skipped");
} else {
  for (const rel of [
    join("dist", "mcp", "server-entry.js"),
    join("dist", "index.js"),
    join("dist", "db", "schema.sql"),
  ]) {
    assert.ok(
      existsSync(join(stagedAtlas, rel)),
      `staged Atlas bundle is missing runtime file ${rel}`,
    );
  }
}

console.log("atlas-release.check.ts — all assertions passed");
