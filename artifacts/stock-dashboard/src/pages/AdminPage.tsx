import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BarChart3, Check, Clock3, RefreshCw, ShieldCheck, Users, X } from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AdminUser = {
  userId: string;
  email: string;
  name: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  reviewedAt: string | null;
  lastSeenAt: string | null;
  usageCount: number;
  lastActivityAt: string | null;
};

type UsageSummary = {
  from: string;
  to: string;
  totalEvents: number;
  activeUsers: number;
  byType: Array<{ eventType: string; count: number }>;
  topTickers: Array<{ ticker: string; count: number }>;
};

const STATUS_LABELS: Record<AdminUser["status"], string> = {
  pending: "ממתין",
  approved: "מאושר",
  rejected: "נדחה",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [usersResponse, usageResponse] = await Promise.all([
        fetch("/api/access/admin/users", { credentials: "include", cache: "no-store" }),
        fetch("/api/access/admin/usage", { credentials: "include", cache: "no-store" }),
      ]);
      if (usersResponse.status === 403 || usageResponse.status === 403) {
        setIsForbidden(true);
        return;
      }
      if (!usersResponse.ok || !usageResponse.ok) throw new Error("לא ניתן לטעון את נתוני הניהול");
      const usersPayload = await usersResponse.json() as { users: AdminUser[] };
      const usagePayload = await usageResponse.json() as UsageSummary;
      setUsers(usersPayload.users);
      setUsage(usagePayload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "לא ניתן לטעון את נתוני הניהול");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (userId: string, status: "approved" | "rejected") => {
    setUpdatingUserId(userId);
    try {
      const response = await fetch(`/api/access/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("עדכון הרשאת המשתמש נכשל");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "עדכון הרשאת המשתמש נכשל");
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (isForbidden) {
    return (
      <main className="min-h-screen bg-background px-4 py-10 text-foreground">
        <section className="mx-auto max-w-lg py-24 text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="mt-5 text-2xl font-bold">אין הרשאת מנהל</h1>
          <p className="mt-3 text-muted-foreground">המסך הזה זמין רק לחשבון המנהל.</p>
          <Button className="mt-6" variant="outline" onClick={() => setLocation("/")}>
            <ArrowRight className="ml-2 h-4 w-4" /> חזרה לדשבורד
          </Button>
        </section>
      </main>
    );
  }

  const pendingUsers = users.filter((user) => user.status === "pending");
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
          <div>
            <p className="flex items-center gap-2 text-sm text-primary"><ShieldCheck className="h-4 w-4" /> StockPulse Admin</p>
            <h1 className="mt-1 text-3xl font-bold">ניהול משתמשים ושימוש</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={isLoading}>
              <RefreshCw className={`ml-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> רענן
            </Button>
            <Button variant="ghost" onClick={() => setLocation("/")}>
              <ArrowRight className="ml-2 h-4 w-4" /> לדשבורד
            </Button>
          </div>
        </header>

        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard icon={<Users />} label="משתמשים" value={users.length} />
          <MetricCard icon={<Clock3 />} label="ממתינים לאישור" value={pendingUsers.length} />
          <MetricCard icon={<BarChart3 />} label="משתמשים פעילים (30 יום)" value={usage?.activeUsers ?? 0} />
          <MetricCard icon={<BarChart3 />} label="אירועי שימוש (30 יום)" value={usage?.totalEvents ?? 0} />
        </div>

        <Card>
          <CardHeader><CardTitle>בקשות ומשתמשים</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading && users.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> טוען…</div>
            ) : users.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">עדיין אין בקשות גישה.</p>
            ) : (
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-border text-right text-muted-foreground">
                  <th className="px-3 py-3 font-medium">משתמש</th>
                  <th className="px-3 py-3 font-medium">סטטוס</th>
                  <th className="px-3 py-3 font-medium">בקשה אחרונה</th>
                  <th className="px-3 py-3 font-medium">פעילות אחרונה</th>
                  <th className="px-3 py-3 font-medium">אירועים</th>
                  <th className="px-3 py-3 font-medium">פעולות</th>
                </tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.userId} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-4">
                        <div className="font-medium">{user.name || "ללא שם"}</div>
                        <div className="font-mono text-xs text-muted-foreground">{user.email}</div>
                      </td>
                      <td className="px-3 py-4"><Badge variant={user.status === "approved" ? "default" : user.status === "rejected" ? "destructive" : "secondary"}>{STATUS_LABELS[user.status]}</Badge></td>
                      <td className="px-3 py-4 text-muted-foreground">{formatDate(user.requestedAt)}</td>
                      <td className="px-3 py-4 text-muted-foreground">{formatDate(user.lastActivityAt ?? user.lastSeenAt)}</td>
                      <td className="px-3 py-4 font-mono">{user.usageCount}</td>
                      <td className="px-3 py-4">
                        <div className="flex gap-2">
                          {user.status !== "approved" && <Button size="sm" onClick={() => void updateStatus(user.userId, "approved")} disabled={updatingUserId === user.userId}><Check className="ml-1 h-3.5 w-3.5" /> אישור</Button>}
                          {user.status !== "rejected" && <Button size="sm" variant="destructive" onClick={() => void updateStatus(user.userId, "rejected")} disabled={updatingUserId === user.userId}><X className="ml-1 h-3.5 w-3.5" /> דחייה</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <UsageList title="שימוש לפי פעולה" items={usage?.byType.map((item) => ({ label: item.eventType, count: item.count })) ?? []} />
          <UsageList title="טיקרים מובילים" items={usage?.topTickers.map((item) => ({ label: item.ticker, count: item.count })) ?? []} />
        </div>
      </div>
    </main>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <Card><CardContent className="flex items-center gap-3 p-5"><div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div><div><div className="text-2xl font-bold">{value.toLocaleString("he-IL")}</div><div className="text-xs text-muted-foreground">{label}</div></div></CardContent></Card>;
}

function UsageList({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent>{items.length === 0 ? <p className="text-sm text-muted-foreground">אין נתונים בטווח הנוכחי.</p> : <div className="space-y-3">{items.map((item) => <div key={item.label} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0"><span>{item.label}</span><span className="font-mono text-muted-foreground">{item.count}</span></div>)}</div>}</CardContent></Card>;
}