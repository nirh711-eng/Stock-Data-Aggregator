import { useEffect, useState, useMemo } from "react";
import { useGetEconomicCalendar, getGetEconomicCalendarQueryKey } from "@workspace/api-client-react";
import { addWeeks, endOfWeek, format, isToday, isTomorrow, isYesterday, startOfWeek } from "date-fns";
import { ExternalLink, Calendar as CalendarIcon, Info, RefreshCw, Star, AlertCircle, Clock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EconomicCalendarEvent } from "@workspace/api-client-react";

// Helper for country badge
const CountryBadge = ({ code }: { code: string }) => {
  if (code === 'US') return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 leading-none">US</span>;
  if (code === 'IL') return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 leading-none">IL</span>;
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground border border-border leading-none">{code}</span>;
}

function formatEventTime(isoString: string) {
  try {
    const date = new Date(isoString);
    let dayStr = "";
    if (isToday(date)) dayStr = "היום";
    else if (isTomorrow(date)) dayStr = "מחר";
    else if (isYesterday(date)) dayStr = "אתמול";
    else dayStr = format(date, "dd/MM");

    return `${dayStr}, ${format(date, "HH:mm")}`;
  } catch (e) {
    return isoString;
  }
}

const COUNTRY_LABELS: Record<string, string> = {
  US: "ארה״ב",
  IL: "ישראל",
};

type DayGroup = {
  key: string;
  label: string;
  countries: Array<{
    code: string;
    label: string;
    events: EconomicCalendarEvent[];
  }>;
};

function groupEventsByDay(events: EconomicCalendarEvent[], descending = false): DayGroup[] {
  const days = new Map<string, { date: Date; countries: Map<string, EconomicCalendarEvent[]> }>();

  for (const event of events) {
    const date = new Date(event.dateTime);
    if (Number.isNaN(date.getTime())) continue;
    const key = format(date, "yyyy-MM-dd");
    const day = days.get(key) ?? { date, countries: new Map<string, EconomicCalendarEvent[]>() };
    const countryEvents = day.countries.get(event.countryCode) ?? [];
    countryEvents.push(event);
    day.countries.set(event.countryCode, countryEvents);
    days.set(key, day);
  }

  return Array.from(days.entries())
    .sort(([, a], [, b]) => {
      const difference = a.date.getTime() - b.date.getTime();
      return descending ? -difference : difference;
    })
    .map(([key, day]) => ({
      key,
      label: new Intl.DateTimeFormat("he-IL", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(day.date),
      countries: Array.from(day.countries.entries()).map(([code, countryEvents]) => ({
        code,
        label: COUNTRY_LABELS[code] ?? code,
        events: countryEvents,
      })),
    }));
}

function formatWeekRange(start: Date, end: Date) {
  const startLabel = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" }).format(start);
  const endLabel = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric" }).format(end);
  return `${startLabel} – ${endLabel}`;
}

function EventRow({ event, isUpcoming }: { event: EconomicCalendarEvent, isUpcoming: boolean }) {
  const isBetter = event.result === "better";
  const isWorse = event.result === "worse";
  
  const actualColor = isBetter ? "text-emerald-500 dark:text-emerald-400" : isWorse ? "text-red-500 dark:text-red-400" : "text-foreground";
  
  // Highlight high importance with a subtle accent bar
  const isHighImpact = event.importance === 3;
  
  return (
    <div className={`flex flex-col md:flex-row md:items-center gap-3 md:gap-4 py-3 px-4 border-b hover:bg-muted/30 transition-colors group relative ${isHighImpact ? 'bg-amber-500/5 hover:bg-amber-500/10 border-l-2 border-border/40 border-l-amber-500/60' : 'border-border/40 border-l-2 border-l-transparent'}`} data-testid={`event-row-${event.id}`}>
      
      {/* Date/Time + Flag */}
      <div className="w-full md:w-32 shrink-0 flex items-center gap-3 md:pr-2">
        <span className="text-xs font-mono text-muted-foreground" data-testid={`text-time-${event.id}`}>
          {formatEventTime(event.dateTime)}
        </span>
        <CountryBadge code={event.countryCode} />
      </div>
      
      {/* Title & Importance */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <a 
          href={event.eventUrl} 
          target="_blank" 
          rel="noreferrer" 
           className={`text-sm font-semibold whitespace-normal break-words leading-snug hover:text-primary transition-colors flex items-center gap-1.5 w-fit ${isHighImpact ? 'text-foreground' : 'text-foreground/90'}`}
          title={event.title}
          data-testid={`link-event-${event.id}`}
        >
          {event.title}
          <ExternalLink className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/100 transition-all shrink-0" />
        </a>
        <div className="flex text-amber-500/80 gap-0.5 mt-1" title={`חשיבות: ${event.importance}/3`} data-testid={`stars-${event.id}`}>
          {Array.from({ length: 3 }).map((_, i) => (
             <Star key={i} className={`w-2.5 h-2.5 ${i < event.importance ? 'fill-current' : 'text-muted-foreground/20'}`} />
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div className="flex items-center justify-between md:justify-end gap-4 md:gap-6 shrink-0 w-full md:w-auto mt-3 md:mt-0 bg-background/50 md:bg-transparent p-2 md:p-0 rounded-lg md:rounded-none border border-border/40 md:border-none">
        
        <div className="flex-1 md:w-20 flex flex-col items-start md:items-end">
          <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">קודם</span>
          <span className="font-mono text-xs text-muted-foreground" data-testid={`text-prev-${event.id}`}>{event.previous || '—'}</span>
        </div>
        
        <div className="flex-1 md:w-20 flex flex-col items-start md:items-end border-r border-border/30 md:border-none pr-3 md:pr-0">
          <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">צפי</span>
          <span className="font-mono text-xs text-foreground/80" data-testid={`text-forecast-${event.id}`}>{event.forecast || '—'}</span>
        </div>
        
        <div className="flex-1 md:w-24 flex flex-col items-end border-r border-border/30 md:border-none pr-3 md:pr-0">
          <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">בפועל</span>
          {event.actual ? (
            <span className={`font-mono text-[13px] font-bold ${actualColor}`} data-testid={`text-actual-${event.id}`}>
              {event.actual}
            </span>
          ) : (
             <span className="text-muted-foreground text-sm font-mono" data-testid={`text-actual-missing-${event.id}`}>—</span>
          )}
        </div>
        
      </div>
    </div>
  )
}

export function EconomicCalendar() {
  const [countryFilter, setCountryFilter] = useState<"US" | "IL">("US");
  const [importanceFilter, setImportanceFilter] = useState<"ALL" | "HIGH" | "MEDIUM">("ALL");
  const [weekOffset, setWeekOffset] = useState<0 | 1>(0);
  const [selectedView, setSelectedView] = useState("summary");
  const [currentDate, setCurrentDate] = useState(() => new Date());

  const { data, isLoading, isError, refetch, isFetching } = useGetEconomicCalendar({
    query: {
      queryKey: getGetEconomicCalendarQueryKey(),
      staleTime: 4 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
    }
  });

  useEffect(() => {
    const nextDay = new Date(currentDate);
    nextDay.setHours(24, 0, 1, 0);
    const timeout = window.setTimeout(() => setCurrentDate(new Date()), nextDay.getTime() - Date.now());
    return () => window.clearTimeout(timeout);
  }, [currentDate]);

  const weekBounds = useMemo(() => {
    const weekStart = startOfWeek(addWeeks(currentDate, weekOffset), { weekStartsOn: 0 });
    return { start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 0 }) };
  }, [currentDate, weekOffset]);

  const weekEvents = useMemo(() => {
    const events = [...(data?.recent ?? []), ...(data?.upcoming ?? [])]
      .filter(event => event.countryCode === countryFilter)
      .filter(event => importanceFilter === "ALL" || (importanceFilter === "HIGH" ? event.importance === 3 : event.importance >= 2))
      .filter(event => {
        const timestamp = new Date(event.dateTime).getTime();
        return timestamp >= weekBounds.start.getTime() && timestamp <= weekBounds.end.getTime();
      })
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
    return events;
  }, [data, countryFilter, importanceFilter, weekBounds]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(weekBounds.start);
      date.setDate(date.getDate() + index);
      const key = format(date, "yyyy-MM-dd");
      return {
        key,
        date,
        label: new Intl.DateTimeFormat("he-IL", { weekday: "short", day: "numeric", month: "short" }).format(date),
        count: weekEvents.filter(event => format(new Date(event.dateTime), "yyyy-MM-dd") === key).length,
      };
    });
  }, [weekBounds, weekEvents]);

  const summaryGroups = useMemo(() => groupEventsByDay(weekEvents), [weekEvents]);
  const selectedDayEvents = useMemo(
    () => selectedView === "summary"
      ? weekEvents
      : weekEvents.filter(event => format(new Date(event.dateTime), "yyyy-MM-dd") === selectedView),
    [selectedView, weekEvents],
  );
  const selectedDayGroups = useMemo(() => groupEventsByDay(selectedDayEvents), [selectedDayEvents]);
  const hasAny = weekEvents.length > 0;
  const hasVisibleEvents = selectedView === "summary" ? hasAny : selectedDayEvents.length > 0;

  const renderDayGroups = (groups: DayGroup[]) => (
    <div className="flex flex-col">
      {groups.map((day) => (
        <div key={day.key} className="border-b border-border/30 last:border-b-0">
          <div
            className="px-5 py-2.5 bg-background border-b border-border/30 flex items-center gap-2"
            data-testid={`calendar-day-${day.key}`}
          >
            <CalendarIcon className="w-3.5 h-3.5 text-primary" />
            <h4 className="text-sm font-bold text-foreground capitalize">{day.label}</h4>
          </div>
          {day.countries.map((country) => (
            <div key={`${day.key}-${country.code}`}>
              <div className="px-5 py-1.5 bg-muted/20 flex items-center gap-2 border-b border-border/20">
                <CountryBadge code={country.code} />
                <span className="text-[11px] font-semibold text-muted-foreground">{country.label}</span>
              </div>
              {country.events.map((event) => (
                <EventRow key={`${day.key}-${event.id}`} event={event} isUpcoming={new Date(event.dateTime).getTime() > Date.now()} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  const selectCountry = (country: "US" | "IL") => {
    setCountryFilter(country);
    setSelectedView("summary");
  };

  const selectWeek = (offset: 0 | 1) => {
    setWeekOffset(offset);
    setSelectedView("summary");
  };

  return (
    <Card className="bg-card border-border overflow-hidden flex flex-col w-full shadow-sm" data-testid="economic-calendar">
      <CardHeader className="pb-4 border-b border-border/40 bg-muted/5 relative overflow-hidden">
        {/* Decorative background element */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-primary" />
              יומן מאקרו כלכלי
            </CardTitle>
            <CardDescription className="text-sm mt-1">
              נתוני מפתח המשפיעים על תנועות השוק, ישירות מ-Investing.com
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 gap-2 bg-background shadow-sm w-fit"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="btn-refresh-calendar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'מרענן...' : 'רענן נתונים'}
          </Button>
        </div>

         {/* Country selector */}
        {!isError && (
           <div className="flex flex-col gap-3 mt-5 relative z-10">
            <div className="flex items-center bg-muted/40 p-1 rounded-md border border-border/50">
              <Button 
                variant={countryFilter === 'US' ? 'secondary' : 'ghost'} 
                size="sm" 
                onClick={() => selectCountry('US')}
                className={`h-7 px-3 text-xs font-medium rounded-sm ${countryFilter === 'US' ? 'bg-background shadow-sm text-blue-600 dark:text-blue-400' : 'text-muted-foreground hover:text-foreground'}`}
                data-testid="btn-filter-country-us"
              >
                ארה״ב
              </Button>
              <Button 
                variant={countryFilter === 'IL' ? 'secondary' : 'ghost'} 
                size="sm" 
                onClick={() => selectCountry('IL')}
                className={`h-7 px-3 text-xs font-medium rounded-sm ${countryFilter === 'IL' ? 'bg-background shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground hover:text-foreground'}`}
                data-testid="btn-filter-country-il"
              >
                ישראל
              </Button>
            </div>
          </div>
        )}
      </CardHeader>
      
      <CardContent className="p-0 flex-1 flex flex-col">
        {isLoading ? (
          <div className="p-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col md:flex-row md:items-center gap-4 py-3 px-4 border border-border/40 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-5 w-6 rounded" />
                  </div>
                  <div className="flex-1 space-y-2 mt-1 md:mt-0">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex gap-4 md:gap-6 mt-3 md:mt-0">
                    <Skeleton className="h-8 w-12 rounded" />
                    <Skeleton className="h-8 w-12 rounded" />
                    <Skeleton className="h-8 w-16 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : isError ? (
          <div className="py-16 flex flex-col items-center justify-center text-center space-y-4 px-4 bg-red-500/5" data-testid="error-state-calendar">
            <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">לא ניתן לטעון את נתוני המאקרו</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                אירעה שגיאה בקבלת הנתונים מהשרת. ייתכן ששירותי Investing.com חווים עומס כרגע.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2" data-testid="btn-retry-calendar">
              <RefreshCw className="w-4 h-4 mr-2" />
              נסה שוב
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="px-4 pt-4">
              <div
                aria-label="בחירת תצוגת היומן"
                className="flex gap-1 overflow-x-auto border-b border-border/50 pb-px scrollbar-thin"
                data-testid="calendar-view-tabs"
              >
                {weekDays.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    aria-pressed={selectedView === day.key}
                    onClick={() => setSelectedView(day.key)}
                    className={`shrink-0 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${selectedView === day.key ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground"}`}
                    data-testid={`calendar-tab-day-${day.key}`}
                  >
                    {day.label}
                    <span className={`mr-1.5 text-[10px] ${day.count > 0 ? "text-primary font-bold" : "opacity-50"}`}>{day.count}</span>
                  </button>
                ))}
                <span className="h-7 w-px bg-border/70 mx-1 shrink-0 self-center" aria-hidden="true" />
                <button
                  type="button"
                  aria-pressed={selectedView === "summary" && weekOffset === 0}
                  onClick={() => selectWeek(0)}
                  className={`shrink-0 px-3 py-2.5 text-xs font-bold border-b-2 transition-colors ${selectedView === "summary" && weekOffset === 0 ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground"}`}
                  data-testid="calendar-tab-week-current"
                >
                  סיכום השבוע הנוכחי
                  {weekOffset === 0 && <span className="mr-1.5 text-[10px] opacity-70">({weekEvents.length})</span>}
                </button>
                <button
                  type="button"
                  aria-pressed={selectedView === "summary" && weekOffset === 1}
                  onClick={() => selectWeek(1)}
                  className={`shrink-0 px-3 py-2.5 text-xs font-bold border-b-2 transition-colors ${selectedView === "summary" && weekOffset === 1 ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground"}`}
                  data-testid="calendar-tab-week-next"
                >
                  סיכום שבוע קדימה
                  {weekOffset === 1 && <span className="mr-1.5 text-[10px] opacity-70">({weekEvents.length})</span>}
                </button>
              </div>
            </div>
            <div className="px-4 pt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center bg-muted/40 p-1 rounded-md border border-border/50">
                <Button
                  variant={importanceFilter === 'ALL' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => { setImportanceFilter('ALL'); setSelectedView('summary'); }}
                  className={`h-7 px-3 text-xs font-medium rounded-sm ${importanceFilter === 'ALL' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  data-testid="btn-filter-importance-all"
                >
                  הכל
                </Button>
                <Button
                  variant={importanceFilter === 'MEDIUM' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => { setImportanceFilter('MEDIUM'); setSelectedView('summary'); }}
                  className={`h-7 px-3 text-xs font-medium rounded-sm ${importanceFilter === 'MEDIUM' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  data-testid="btn-filter-importance-medium"
                >
                  בינונית+
                </Button>
                <Button
                  variant={importanceFilter === 'HIGH' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => { setImportanceFilter('HIGH'); setSelectedView('summary'); }}
                  className={`h-7 px-3 text-xs font-medium rounded-sm flex items-center gap-1.5 ${importanceFilter === 'HIGH' ? 'bg-background shadow-sm text-amber-600 dark:text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
                  data-testid="btn-filter-importance-high"
                >
                  גבוהה בלבד
                  <Star className="w-2.5 h-2.5 fill-current" />
                </Button>
              </div>
              <span className="text-xs font-medium text-muted-foreground" data-testid="text-selected-week">
                {formatWeekRange(weekBounds.start, weekBounds.end)}
              </span>
            </div>
            <div
              className="flex flex-col"
              role="region"
              aria-live="polite"
              aria-label={selectedView === "summary" ? "סיכום אירועי השבוע" : "אירועי היום שנבחר"}
              data-testid="calendar-view-panel"
            >
            {!hasVisibleEvents ? (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 px-4" data-testid="empty-state-calendar">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center">
              <CalendarIcon className="w-5 h-5 text-muted-foreground/60" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">
                {selectedView === "summary" ? "אין אירועים השבוע" : "אין אירועים ביום הזה"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">לא נמצאו אירועי מאקרו התואמים למדינה, לשבוע ולסינון שבחרת.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setImportanceFilter('ALL'); setSelectedView('summary'); }} className="text-primary hover:text-primary/80" data-testid="btn-clear-filters">
              נקה סינונים
            </Button>
          </div>
            ) : (
              <div className="pt-3">
                <div className="px-5 py-2 bg-muted/30 border-y border-border/40">
                  <h3 className="text-[11px] font-bold text-primary/80 tracking-wider uppercase flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {selectedView === "summary"
                      ? `${weekOffset === 0 ? "סיכום השבוע הנוכחי" : "סיכום שבוע קדימה"} — ${COUNTRY_LABELS[countryFilter]} (${formatWeekRange(weekBounds.start, weekBounds.end)})`
                      : `${weekDays.find((day) => day.key === selectedView)?.label ?? "היום שנבחר"} — ${COUNTRY_LABELS[countryFilter]} (${selectedDayEvents.length} אירועים)`}
                  </h3>
                </div>
                {renderDayGroups(selectedView === "summary" ? summaryGroups : selectedDayGroups)}
              </div>
            )}
            </div>
          </div>
        )}
        {data && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[11px] text-muted-foreground/60 px-5 py-4 bg-muted/10 border-t border-border/40">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Tooltip>
                <TooltipTrigger className="cursor-help flex items-center gap-1.5 hover:text-muted-foreground transition-colors" data-testid="tooltip-utc-info">
                  <Info className="w-3.5 h-3.5" />
                  השעות הומרו אוטומטית לזמן המקומי
                </TooltipTrigger>
                <TooltipContent className="text-xs bg-popover border border-border shadow-lg p-3 max-w-xs">
                  <p className="font-medium mb-1">המרת אזור זמן</p>
                  <p className="text-muted-foreground">הזמנים המקוריים מתקבלים ב-{data.timeZone} ומומרים אצלך בדפדפן לשעון המקומי כדי למנוע בלבול.</p>
                </TooltipContent>
              </Tooltip>
              <span className="hidden sm:inline">•</span>
              <span>
                מקור נתונים: <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-primary transition-colors font-medium" data-testid="link-source">Investing.com</a>
              </span>
              {data.unavailableCountries.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400" data-testid="status-partial-calendar">
                  כיסוי חלקי: {data.unavailableCountries.join(", ")}
                </span>
              )}
            </div>
            
            {data.generatedAt && (
              <div className="flex items-center gap-1.5 shrink-0" data-testid="text-updated-at">
                <RefreshCw className="w-3 h-3" />
                עודכן לאחרונה: {new Date(data.generatedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
