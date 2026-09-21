import Image from "next/image";
import type { Metadata } from "next";
import { Aurora } from "@/components/landing/aurora";
import { TempestLogo } from "@/components/icons/tempest-logo";

export const metadata: Metadata = {
  title: "Tempest — Scan to Download",
  description: "Point your camera. Ship in a minute.",
  robots: { index: false, follow: false },
};

const AURORA_COLORS = [
  "#000000",
  "#7c3aed",
  "#000000",
  "#d946ef",
  "#000000",
  "#f97316",
  "#000000",
];

export default function DisplayPage() {
  return (
    <div className="fixed inset-0 z-[100] h-[100vh] w-[100vw] overflow-hidden bg-[#050608] text-white">
      <Aurora className="absolute inset-0 h-full w-full" colors={AURORA_COLORS} />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-10 px-16 text-center">
        <span className="font-mono text-[13px] uppercase tracking-[0.24em] text-white/60">
          Agentic engineering that actually scales
        </span>
        <TempestLogo className="h-auto w-[min(78vw,1100px)] text-white drop-shadow-[0_10px_60px_rgba(124,58,237,0.4)]" />
        <p className="max-w-[64ch] text-[18px] font-light leading-[1.55] text-white/60">
          Run Claude Code, Codex, Gemini and any other CLI agents in parallel — each
          in its own worktree, sandboxed and token-lean.
        </p>
      </div>

      <div className="absolute bottom-8 right-8 z-10 flex flex-col items-center gap-2">
        <div className="border border-dashed border-white/20 bg-white p-3 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
          <Image
            src="/display-qr.svg"
            alt="Scan to download Tempest"
            width={168}
            height={168}
            unoptimized
            className="block h-[168px] w-[168px]"
          />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
          Scan · tempestai.dev
        </span>
      </div>
    </div>
  );
}
