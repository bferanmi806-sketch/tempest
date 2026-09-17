import { invoke } from "@tauri-apps/api/core";
import { createTerminalRendererPolicy } from "./terminalRendererPolicy";

export const terminalRendererPolicy = createTerminalRendererPolicy(() => invoke<boolean>("is_wsl"));
