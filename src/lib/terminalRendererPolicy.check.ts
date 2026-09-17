import assert from "node:assert/strict";
import { createTerminalRendererPolicy } from "./terminalRendererPolicy.ts";

for (const [platform, isWsl] of [
  ["WSL/WSLg", true],
  ["native Linux", false],
  ["Windows", false],
  ["macOS", false],
] as const) {
  let probes = 0;
  let resolveProbe!: (value: boolean) => void;
  const policy = createTerminalRendererPolicy(() => {
    probes++;
    return new Promise<boolean>((resolve) => { resolveProbe = resolve; });
  });
  assert.equal(policy.allowsWebgl(), false, "no WebGL before initialization");
  const first = policy.initialize();
  assert.equal(policy.initialize(), first, "concurrent initialization shares one promise");
  await Promise.resolve();
  assert.equal(probes, 1);
  assert.equal(policy.allowsWebgl(), false, "no WebGL while detection is pending");
  resolveProbe(isWsl);
  await first;
  assert.equal(policy.allowsWebgl(), !isWsl, platform);
  await policy.initialize();
  assert.equal(probes, 1, "resolved platform fact is cached");
  assert.equal(policy.allowsWebgl(), !isWsl, "repeated reads preserve policy");
}

const originalError = console.error;
const errors: unknown[][] = [];
console.error = (...args: unknown[]) => { errors.push(args); };
try {
  for (const synchronous of [false, true]) {
    let probes = 0;
    const policy = createTerminalRendererPolicy(() => {
      probes++;
      if (synchronous) throw new Error("probe unavailable");
      return Promise.reject(new Error("IPC unavailable"));
    });
    await policy.initialize();
    assert.equal(policy.allowsWebgl(), true, "failed probe preserves previous WebGL eligibility");
    await policy.initialize();
    assert.equal(probes, 1, "failure does not trigger per-pane IPC retries");
  }
  assert.equal(errors.length, 2, "probe failures are reported once");
} finally {
  console.error = originalError;
}

console.log("terminalRendererPolicy: all checks passed");
