/* ------------------------------------------------------------------ */
/* small shared pieces                                                 */
/* ------------------------------------------------------------------ */

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`micro text-[#7f93a8] ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* loading                                                             */
/* ------------------------------------------------------------------ */

export function LoadingScreen({ progress, label }: { progress: number; label: string }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#04050a] scanlines">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(40,60,90,0.16),transparent_65%)]" />
      <div className="anim-in relative flex w-[min(560px,86vw)] flex-col items-center">
        <div className="micro text-[#6d8499]">Halcyon Biosystems · Facility Archive</div>
        <h1 className="mt-5 text-center text-[clamp(34px,7vw,64px)] font-bold leading-[0.95] tracking-[0.14em] text-[#dfe7ef]">
          SITE ORPHEUS
        </h1>
        <div className="mt-3 mono text-[11px] tracking-[0.3em] text-[#8a6a3a]">SUB-LEVEL 3 · SECTOR C</div>

        <div className="mt-12 h-[2px] w-full bg-[#141a22]">
          <div
            className="h-full bg-gradient-to-r from-[#3d6f8e] to-[#9fd0e8] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-3 flex w-full items-center justify-between">
          <span className="mono text-[10px] tracking-[0.24em] text-[#5f7386]">{label.toUpperCase()}</span>
          <span className="mono text-[10px] tracking-[0.24em] text-[#8fb0c6]">{pct}%</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* start / intro                                                       */
/* ------------------------------------------------------------------ */

export function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#04050a]/92 backdrop-blur-[2px] scanlines">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(30,50,75,0.22),transparent_60%)]" />
      <div className="anim-up relative w-[min(720px,90vw)] px-2 py-10 text-center">
        <div className="micro text-[#6d8499]">Halcyon Biosystems · decommissioned 1994</div>
        <h1 className="mt-4 text-[clamp(30px,6vw,58px)] font-bold leading-[1] tracking-[0.16em] text-[#e2eaf2]">
          SITE ORPHEUS
        </h1>
        <p className="mx-auto mt-6 max-w-[52ch] text-[15px] leading-relaxed text-[#93a6b8]">
          A subsurface biology station, sealed after a containment failure and left to the dark. The
          grid was cut by hand. Something down here is still on the auxiliary buses.
        </p>

        <div className="mx-auto mt-9 grid max-w-[520px] grid-cols-2 gap-x-8 gap-y-2 text-left sm:grid-cols-4">
          {[
            ["W A S D", "move"],
            ["MOUSE", "look"],
            ["SHIFT", "sprint"],
            ["C", "crouch"],
            ["E", "interact"],
            ["ESC", "release"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 border-t border-[#18202a] pt-2">
              <span className="mono text-[11px] tracking-[0.16em] text-[#cfe0ee]">{k}</span>
              <span className="micro text-[#5f7386]">{v}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onStart}
          className="group mt-11 inline-flex items-center gap-3 border border-[#2a3a4a] bg-[#0a1018]/80 px-8 py-3 text-[#dbe7f1] transition-colors duration-300 hover:border-[#6f9fbe] hover:bg-[#0e1721]"
        >
          <span className="micro text-[#cfe0ee]">Enter the facility</span>
          <span className="h-[7px] w-[7px] rounded-full bg-[#7fd0ff] transition-transform duration-300 group-hover:scale-125" />
        </button>
        <div className="mt-5 micro text-[#45586a]">Audio is generated live · headphones recommended</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* hud                                                                 */
/* ------------------------------------------------------------------ */

export function Hud({
  prompt,
  objective,
  zone,
  flavor,
  locked,
}: {
  prompt: { label: string; kind: string } | null;
  objective: string;
  zone: string;
  flavor: string | null;
  locked: boolean;
}) {
  return (
    <div data-ui="hud" className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* crosshair */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className={`rounded-full bg-[#dbe7f1] transition-all duration-200 ${
            prompt ? "h-[3px] w-[3px] opacity-90" : "h-[2px] w-[2px] opacity-40"
          }`}
        />
        {prompt && (
          <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#9fd0e8]/25" />
        )}
      </div>

      {/* interaction prompt */}
      {prompt && (
        <div className="anim-up absolute bottom-[16%] left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-3 border border-[#22303e] bg-[#060a10]/85 px-4 py-2 vignette-panel">
            <span className="mono text-[11px] tracking-[0.2em] text-[#9fd0e8]">E</span>
            <span className="micro text-[#c3d3e0]">{prompt.label}</span>
          </div>
        </div>
      )}

      {/* objective - always visible, re-animates whenever it changes */}
      <div className="absolute left-6 top-6 max-w-[300px]">
        <Label>Objective</Label>
        <div
          key={objective}
          className="anim-up mt-1 border-l border-[#3f7ea3] pl-3 text-[13.5px] leading-snug text-[#c2d4e3]"
        >
          {objective}
        </div>
      </div>

      {/* zone */}
      <div className="absolute bottom-6 left-6">
        <div className="mono text-[10px] tracking-[0.28em] text-[#5f7386]">{zone}</div>
      </div>

      {/* controls reminder */}
      <div className="absolute bottom-6 right-6 text-right">
        <div className="mono text-[10px] tracking-[0.2em] text-[#3f5262]">
          WASD · MOUSE · SHIFT · C · E
        </div>
      </div>

      {/* flavour line */}
      {flavor && (
        <div className="anim-up absolute bottom-[26%] left-1/2 w-[min(620px,88vw)] -translate-x-1/2 text-center">
          <div className="inline-block border border-[#22303e] bg-[#060a10]/85 px-5 py-2.5 text-[13px] leading-relaxed text-[#b6c7d6] vignette-panel">
            {flavor}
          </div>
        </div>
      )}

      {!locked && (
        <div className="anim-in absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-16">
          <div className="mono text-[10px] tracking-[0.3em] text-[#5f7386] pulse">CLICK TO RESUME</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* log / terminal overlay                                              */
/* ------------------------------------------------------------------ */

export function LogPanel({
  title,
  lines,
  onClose,
}: {
  title: string;
  lines: string[];
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#03050a]/80 backdrop-blur-[1px] scanlines">
      <div className="anim-up w-[min(680px,92vw)] border border-[#22303e] bg-[#060a10]/95 p-7 vignette-panel">
        <div className="flex items-center justify-between border-b border-[#1a242e] pb-3">
          <span className="mono text-[11px] tracking-[0.24em] text-[#9fd0e8]">{title}</span>
          <span className="mono text-[10px] tracking-[0.24em] text-[#4a5f70]">READ ONLY</span>
        </div>
        <div className="mono mt-5 space-y-1.5 text-[12.5px] leading-relaxed text-[#9fb4c4]">
          {lines.map((l, i) => (
            <div key={i} className={l === "" ? "h-2" : ""}>
              {l}
            </div>
          ))}
        </div>
        <div className="mt-7 flex items-center justify-between">
          <span className="micro text-[#45586a]">Press E or Esc to step back</span>
          <button
            onClick={onClose}
            className="border border-[#2a3a4a] px-4 py-1.5 micro text-[#c3d3e0] transition-colors hover:border-[#6f9fbe]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* keypad                                                              */
/* ------------------------------------------------------------------ */

export function Keypad({
  code,
  denied,
  onDigit,
  onClose,
}: {
  code: string;
  denied: boolean;
  onDigit: (d: string) => void;
  onClose: () => void;
}) {
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#03050a]/80 backdrop-blur-[1px]">
      <div className="anim-up w-[min(340px,90vw)] border border-[#22303e] bg-[#060a10]/95 p-6 vignette-panel">
        <div className="mono text-[11px] tracking-[0.24em] text-[#9fd0e8]">RECORDS · ACCESS</div>
        <div
          className={`mono mt-4 flex h-12 items-center justify-center border ${
            denied ? "border-[#8d3a30] text-[#e08a7a]" : "border-[#1c2833] text-[#9fd0e8]"
          } bg-[#04070c] text-[22px] tracking-[0.6em]`}
        >
          {denied ? "DENIED" : (code.padEnd(4, "·") || "····")}
        </div>
        <div className="mt-5 grid grid-cols-5 gap-2">
          {digits.map((d) => (
            <button
              key={d}
              onClick={() => onDigit(d)}
              className="mono border border-[#1c2833] bg-[#080d14] py-2.5 text-[13px] text-[#b6c7d6] transition-colors hover:border-[#4f7f9c] hover:text-[#e2eaf2]"
            >
              {d}
            </button>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <span className="micro text-[#45586a]">Esc to cancel</span>
          <button
            onClick={onClose}
            className="border border-[#2a3a4a] px-4 py-1.5 micro text-[#c3d3e0] transition-colors hover:border-[#6f9fbe]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ending                                                              */
/* ------------------------------------------------------------------ */

export function Ending() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center pb-[12%]">
      <div className="anim-up text-center">
        <div className="mono text-[11px] tracking-[0.34em] text-[#9fd0e8]">SEAL LOGGED · 44-B</div>
        <div className="mt-3 text-[13px] text-[#7f93a8]">Nothing else down here is going to answer.</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* error                                                               */
/* ------------------------------------------------------------------ */

export function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#04050a] p-6">
      <div className="w-[min(560px,92vw)] border border-[#3a2422] bg-[#0a0708] p-8">
        <div className="micro text-[#c07a6a]">System fault</div>
        <h2 className="mt-3 text-[22px] font-bold tracking-[0.08em] text-[#e6d5d0]">RENDERER OFFLINE</h2>
        <p className="mono mt-4 text-[12px] leading-relaxed text-[#9a8a86]">{message}</p>
        <p className="mt-6 text-[13px] leading-relaxed text-[#7f6d69]">
          This experience needs a WebGL-capable browser with hardware acceleration enabled. Try a
          recent version of Chrome, Edge, Firefox or Safari.
        </p>
      </div>
    </div>
  );
}
