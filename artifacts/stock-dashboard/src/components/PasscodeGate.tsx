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
      className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0a]"
      style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}
    >
      <div
        className={`w-full max-w-sm px-8 py-10 rounded-2xl border border-[#1f2937] bg-[#111827]/80 shadow-2xl flex flex-col items-center gap-6 transition-all ${
          shake ? "animate-shake" : ""
        }`}
        style={shake ? { animation: "shake 0.5s ease" } : {}}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-full bg-[#1a2535] border border-[#243044]">
            <Shield className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-white text-xl font-bold tracking-widest uppercase">StockPulse</h1>
          <p className="text-[#6b7280] text-xs tracking-wider text-center">
            RESTRICTED ACCESS — ENTER ACCESS CODE
          </p>
        </div>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div className="relative">
            <Lock
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4b5563]"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="password"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              placeholder="••••••••••"
              autoComplete="off"
              className={`w-full bg-[#0d1117] border ${
                error ? "border-red-500 text-red-400" : "border-[#1f2937] text-white"
              } rounded-lg pl-10 pr-4 py-3 text-sm tracking-widest placeholder-[#374151] outline-none focus:border-emerald-500 transition-colors`}
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs text-center tracking-wider animate-pulse">
              ✗ &nbsp;קוד שגוי — נסה שוב
            </p>
          )}

          <button
            type="submit"
            className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-bold py-3 rounded-lg tracking-widest uppercase transition-colors"
          >
            כניסה
          </button>
        </form>

        <p className="text-[#374151] text-[10px] tracking-widest text-center">
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
