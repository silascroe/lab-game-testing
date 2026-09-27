import { useCallback, useEffect, useRef, useState } from "react";
import { Lab, LOGS } from "./engine/Lab";
import {
  Ending,
  ErrorScreen,
  Hud,
  Keypad,
  LoadingScreen,
  LogPanel,
  StartScreen,
} from "./ui/Overlays";

type Phase = "loading" | "intro" | "playing";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labRef = useRef<Lab | null>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [loadLabel, setLoadLabel] = useState("Booting");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [prompt, setPrompt] = useState<{ label: string; kind: string } | null>(null);
  const [objective, setObjective] = useState("Restore auxiliary power");
  const [zone, setZone] = useState("AIRLOCK · DECONTAMINATION");
  const [flavor, setFlavor] = useState<string | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [keypad, setKeypad] = useState<{ code: string; denied: boolean } | null>(null);
  const [finished, setFinished] = useState(false);

  const flavorTimer = useRef<number | null>(null);
  const keypadTimer = useRef<number | null>(null);
  const [objectivePulse, setObjectivePulse] = useState(0);

  const showFlavor = useCallback((msg: string) => {
    setFlavor(msg);
    if (flavorTimer.current) window.clearTimeout(flavorTimer.current);
    flavorTimer.current = window.setTimeout(() => {
      flavorTimer.current = null;
      setFlavor(null);
    }, 6500);
  }, []);

  /* ------------------------------------------------------------------ */
  /* engine lifecycle                                                    */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const lab = new Lab(canvas, {
      onProgress: (p, label) => {
        setProgress(p);
        setLoadLabel(label);
      },
      onReady: () => setPhase((prev) => (prev === "loading" ? "intro" : prev)),
      onZone: setZone,
      onPrompt: setPrompt,
      onObjective: (text) => {
        setObjective(text);
        setObjectivePulse((n) => n + 1);
      },
      onFlavor: showFlavor,
      onPointerLock: setLocked,
      onError: setError,
      onFinished: () => {
        setFinished(true);
        lab.setUiBlocked(true);
      },
      onLog: (id) => {
        if (id === "__keypad__") {
          if (keypadTimer.current !== null) window.clearTimeout(keypadTimer.current);
          keypadTimer.current = null;
          setKeypad({ code: "", denied: false });
          return;
        }
        setLogId(id);
        lab.setUiBlocked(true);
      },
    });
    labRef.current = lab;
    lab.boot();

    // Keep the test/debug API out of normal visits. Diagnostic scripts opt in
    // with ?test=1; the API includes helpers that bypass ordinary gameplay.
    const debugWindow = window as Window & { __lab?: Lab };
    if (new URLSearchParams(window.location.search).get("test") === "1") {
      debugWindow.__lab = lab;
    }

    return () => {
      lab.dispose();
      if (flavorTimer.current !== null) window.clearTimeout(flavorTimer.current);
      if (keypadTimer.current !== null) window.clearTimeout(keypadTimer.current);
      if (debugWindow.__lab === lab) delete debugWindow.__lab;
      labRef.current = null;
    };
  }, [showFlavor]);

  /* keep the keypad in sync with the engine buffer */
  useEffect(() => {
    if (!keypad) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeKeypad();
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        pushDigit(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypad]);

  const pushDigit = (d: string) => {
    const lab = labRef.current;
    if (!lab || !keypad) return;
    const code = keypad.code + d;
    const accepted = lab.submitKeypad(d);
    if (code.length < 4) {
      setKeypad({ code, denied: false });
      return;
    }
    if (accepted) {
      if (keypadTimer.current !== null) window.clearTimeout(keypadTimer.current);
      keypadTimer.current = null;
      setKeypad(null);
    } else {
      lab.clearKeypad();
      setKeypad({ code: "", denied: true });
      if (keypadTimer.current !== null) window.clearTimeout(keypadTimer.current);
      keypadTimer.current = window.setTimeout(() => {
        keypadTimer.current = null;
        setKeypad((current) => (current ? { code: "", denied: false } : null));
      }, 1100);
    }
  };

  const closeKeypad = () => {
    if (keypadTimer.current !== null) window.clearTimeout(keypadTimer.current);
    keypadTimer.current = null;
    labRef.current?.closeKeypad();
    setKeypad(null);
  };

  const closeLog = useCallback(() => {
    setLogId(null);
    labRef.current?.setUiBlocked(false);
  }, []);

  /* E / Esc closes the log panel */
  useEffect(() => {
    if (!logId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.code === "KeyE") closeLog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [logId, closeLog]);

  const startExperience = useCallback(() => {
    setPhase("playing");
    labRef.current?.requestLock();
  }, []);

  /* ------------------------------------------------------------------ */

  const activeLog = logId ? LOGS[logId] : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#04050a]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {phase === "playing" && !error && !finished && (
        <Hud
          key={objectivePulse}
          prompt={prompt}
          objective={objective}
          zone={zone}
          flavor={flavor}
          locked={locked}
        />
      )}

      {phase === "playing" && finished && <Ending />}

      {activeLog && <LogPanel title={activeLog.title} lines={activeLog.lines} onClose={closeLog} />}

      {keypad && (
        <Keypad
          code={keypad.code}
          denied={keypad.denied}
          onDigit={pushDigit}
          onClose={closeKeypad}
        />
      )}

      {phase === "loading" && !error && <LoadingScreen progress={progress} label={loadLabel} />}

      {phase === "intro" && !error && <StartScreen onStart={startExperience} />}

      {error && <ErrorScreen message={error} />}
    </div>
  );
}
