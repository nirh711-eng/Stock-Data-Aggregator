import { useState, useRef, useEffect } from "react";
import { Lock, Shield } from "lucide-react";

const CODE = import.meta.env.VITE_ACCESS_CODE as string;
const STORAGE_KEY = "sp_auth";

function isAuthed(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setAuthed() {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch { /* ignore */ }
}

interface PasscodeGateProps {
  children: React.ReactNode;
}

export function PasscodeGate({ children }: PasscodeGateProps) {
  const [unlocked, setUnlocked] = useState(isAuthed);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!unlocked) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [unlocked]);

  if (unlocked) return <>{children}</>;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === CODE) {
      setAuthed();
      setUnlocked(true);
    } else {
      setError(true);
      setShake(true);
      setInput("");
      setTimeout(() => setShake(false), 600);
      setTimeout(() => setError(false), 2000);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-background"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <div
        className={`w-full max-w-sm px-8 py-10 rounded-2xl border border-border bg-card shadow-lg flex flex-col items-center gap-6 transition-all ${
          shake ? "animate-shake" : ""
        }`}
        style={shake ? { animation: "shake 0.5s ease" } : {}}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-full bg-primary/10 border border-primary/20">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-foreground text-xl font-bold tracking-widest uppercase">StockPulse</h1>
          <p className="text-muted-foreground text-xs tracking-wider text-center">
            RESTRICTED ACCESS — ENTER ACCESS CODE
          </p>
        </div>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div className="relative">
            <Lock
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="password"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              placeholder="••••••••••"
              autoComplete="off"
              className={`w-full bg-background border ${
                error ? "border-destructive text-destructive" : "border-input text-foreground"
              } rounded-lg pl-10 pr-4 py-3 text-sm tracking-widest placeholder-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors`}
            />
          </div>

          {error && (
            <p className="text-destructive text-xs text-center tracking-wider animate-pulse">
              ✗ &nbsp;קוד שגוי — נסה שוב
            </p>
          )}

          <button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground text-sm font-bold py-3 rounded-lg tracking-widest uppercase transition-colors"
          >
            כניסה
          </button>
        </form>

        <p className="text-muted-foreground/60 text-[10px] tracking-widest text-center">
          AUTHORIZED PERSONNEL ONLY
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-8px); }
          30% { transform: translateX(8px); }
          45% { transform: translateX(-6px); }
          60% { transform: translateX(6px); }
          75% { transform: translateX(-4px); }
          90% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
