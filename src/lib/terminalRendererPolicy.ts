export function createTerminalRendererPolicy(probeWsl: () => Promise<boolean>) {
  let webglAllowed = false;
  let initialization: Promise<void> | undefined;

  return {
    initialize(): Promise<void> {
      initialization ??= Promise.resolve()
        .then(probeWsl)
        .then((isWsl) => { webglAllowed = !isWsl; })
        .catch((error) => {
          console.error("[terminalRenderer] WSL detection failed:", error);
          webglAllowed = true;
        });
      return initialization;
    },
    allowsWebgl(): boolean {
      return webglAllowed;
    },
  };
}
