import { useLocation } from "wouter";
import { Activity, Cloud, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthLanding() {
  const [, setLocation] = useLocation();

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <section className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center text-center">
        <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-primary">
          <Activity className="h-9 w-9" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">StockPulse</h1>
        <p className="mt-4 max-w-xl text-lg leading-8 text-muted-foreground">
          מודיעין שוק אישי. התחבר כדי לשמור את המניות והמקורות שלך בחשבון אחד, ולהמשיך בדיוק מאותה נקודה בכל מכשיר.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={() => setLocation("/sign-up")}>יצירת חשבון</Button>
          <Button size="lg" variant="outline" onClick={() => setLocation("/sign-in")}>כניסה לחשבון</Button>
        </div>
        <div className="mt-12 grid gap-4 text-right sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <Cloud className="mb-2 h-5 w-5 text-primary" />
            <h2 className="font-semibold">סנכרון רציף</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">רשימת המעקב והמקורות השמורים זמינים בכל דפדפן שבו נכנסת.</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <ShieldCheck className="mb-2 h-5 w-5 text-primary" />
            <h2 className="font-semibold">העדפות פרטיות</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">הנתונים נשמרים בחשבון שלך בלבד; נתונים מקומיים חדשים מתמזגים בבטחה בעת הכניסה.</p>
          </div>
        </div>
      </section>
    </main>
  );
}