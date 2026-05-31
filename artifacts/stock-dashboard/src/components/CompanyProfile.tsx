import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Globe, Users, ChevronDown, ChevronUp, Handshake, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface StockData {
  description: string | null;
  sector: string | null;
  industry: string | null;
  companyName: string;
}

interface Agreement {
  type: string;
  partner: string | null;
  description: string;
}

interface ProfileData {
  ticker: string;
  companyName: string;
  description: string | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  country: string | null;
  employees: number | null;
  agreements: Agreement[];
  generatedAt: string;
}

interface Props {
  ticker: string;
  stockData: StockData;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function fetchProfile(ticker: string): Promise<ProfileData> {
  const res = await fetch(`${BASE}/api/stocks/${ticker}/profile`);
  if (!res.ok) throw new Error("Profile fetch failed");
  return res.json() as Promise<ProfileData>;
}

export function CompanyProfile({ ticker, stockData }: Props) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery<ProfileData>({
    queryKey: ["companyProfile", ticker],
    queryFn: () => fetchProfile(ticker),
    staleTime: 1000 * 60 * 30,
  });

  const description = stockData.description ?? data?.description ?? null;
  const sector = stockData.sector ?? data?.sector ?? null;
  const industry = stockData.industry ?? data?.industry ?? null;
  const website = data?.website ?? null;
  const country = data?.country ?? null;
  const employees = data?.employees ?? null;
  const agreements = data?.agreements ?? [];

  const PREVIEW_LEN = 220;
  const shortDesc = description && description.length > PREVIEW_LEN
    ? description.slice(0, PREVIEW_LEN).replace(/\s\S*$/, "") + "..."
    : description;

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
          <Building2 className="w-4 h-4" />
          פרופיל החברה
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Sector / Industry / Country badges */}
        <div className="flex flex-wrap gap-2">
          {sector && (
            <Badge variant="secondary" className="text-xs font-medium">
              סקטור: {sector}
            </Badge>
          )}
          {industry && (
            <Badge variant="outline" className="text-xs font-medium">
              תעשייה: {industry}
            </Badge>
          )}
          {country && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {country}
            </Badge>
          )}
          {employees != null && (
            <Badge variant="outline" className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="w-3 h-3" />
              {employees.toLocaleString()} עובדים
            </Badge>
          )}
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer">
              <Badge variant="outline" className="text-xs text-primary/70 hover:text-primary cursor-pointer flex items-center gap-1 transition-colors">
                <Globe className="w-3 h-3" />
                אתר החברה
              </Badge>
            </a>
          )}
        </div>

        {/* Company Description */}
        {description ? (
          <div className="space-y-1">
            <p className="text-sm leading-relaxed text-foreground/80 text-right" dir="auto">
              {expanded ? description : shortDesc}
            </p>
            {description.length > PREVIEW_LEN && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors mt-1"
              >
                {expanded ? (
                  <><ChevronUp className="w-3 h-3" /> הצג פחות</>
                ) : (
                  <><ChevronDown className="w-3 h-3" /> קרא עוד</>
                )}
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">תיאור לא זמין.</p>
        )}

        {/* Active Agreements */}
        <div className="pt-1">
          <div className="flex items-center gap-2 mb-3">
            <Handshake className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">הסכמים פעילים</span>
            {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-2">
                  <Skeleton className="h-4 w-24 flex-shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : agreements.length > 0 ? (
            <div className="space-y-2.5">
              {agreements.map((ag, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm group">
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-5 shrink-0 font-normal text-primary/70 border-primary/20 bg-primary/5 mt-0.5"
                  >
                    {ag.type}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    {ag.partner && (
                      <span className="font-medium text-foreground/90 text-xs">{ag.partner} — </span>
                    )}
                    <span className="text-foreground/70 text-xs">{ag.description}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : !isLoading ? (
            <p className="text-xs text-muted-foreground">לא נמצאו הסכמים פעילים.</p>
          ) : null}
        </div>

      </CardContent>
    </Card>
  );
}
