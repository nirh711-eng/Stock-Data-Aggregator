import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/react";
import { Clock3, LogOut, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUsageTracking } from "@/hooks/useUsageTracking";

type AccessStatus = "pending" | "approved" | "rejected";

type AccessPayload = {
  status: AccessStatus;
  isAdmin: boolean;
  emailConfigured: boolean;
  notification: "sent" | "not_configured" | "failed" | "not_needed";
  user: { email: string; name: string };
};

export function AccessGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const { track } = useUsageTracking();
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loginTrackedFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/access/status", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json() as AccessPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "לא ניתן לבדוק את הרשאת הגישה");
      setAccess(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "לא ניתן לבדוק את הרשאת הגישה");
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh, userId]);

  useEffect(() => {
    if (access?.status !== "approved" || !userId || loginTrackedFor.current === userId) return;
    loginTrackedFor.current = userId;
    track("login");
  }, [access?.status, track, userId]);

  useEffect(() => {
    if (access?.status !== "pending") return;
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [access?.status, refresh]);

  if (!isLoaded || (isSignedIn && isLoading && !access)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) return null;
  if (access?.status === "approved") return <>{children}</>;

  const signOutAndReturn = () => void signOut({ redirectUrl: import.meta.env.BASE_URL });

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <section className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center text-center">
        {access?.status === "rejected" ? (
          <XCircle className="h-12 w-12 text-destructive" />
        ) : (
          <Clock3 className="h-12 w-12 text-primary" />
        )}
        <h1 className="mt-5 text-2xl font-bold">
          {access?.status === "rejected" ? "בקשת הגישה נדחתה" : "בקשת הגישה ממתינה לאישור"}
        </h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          {access?.status === "rejected"
            ? "המנהל דחה את בקשת הגישה לחשבון הזה."
            : "החשבון נוצר בהצלחה. לאחר אישור המנהל, הדשבורד ייפתח אוטומטית."}
        </p>
        {access?.user.email && (
          <p className="mt-2 text-sm font-mono text-foreground/80">{access.user.email}</p>
        )}
        {access && !access.emailConfigured && access.status === "pending" && (
          <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            שליחת מייל למנהל עדיין לא מוגדרת. ניתן לאשר את המשתמש מתוך מסך הניהול.
          </p>
        )}
        {error && (
          <p className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {access?.status === "pending" && (
            <Button onClick={() => void refresh()} variant="outline" disabled={isLoading}>
              <RefreshCw className={`ml-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              בדוק שוב
            </Button>
          )}
          <Button onClick={signOutAndReturn} variant="ghost">
            <LogOut className="ml-2 h-4 w-4" />
            יציאה
          </Button>
        </div>
        <ShieldCheck className="mt-10 h-5 w-5 text-muted-foreground/40" />
      </section>
    </main>
  );
}