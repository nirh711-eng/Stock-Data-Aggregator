import { useState } from "react";
import { Building2, Globe, Users, ChevronDown, ChevronUp, Handshake, Loader2, Target, CheckCircle2, AlertCircle, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getGetStockProfileQueryKey, useGetStockProfile } from "@workspace/api-client-react";

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

interface CompanySpecialization {
  status: "available" | "insufficient_data" | "unavailable";
  primaryProduct?: string | null;
  offerings?: string[];
  customerMarkets?: string[];
  keywords?: string[];
  confidence: "high" | "medium" | "low" | "unknown";
  source?: string | null;
  generatedAt?: string | null;
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
  specialization?: CompanySpecialization;
}

interface Props {
  ticker: string;
  stockData: StockData;
}

export function CompanyProfile({ ticker, stockData }: Props) {
  const [expanded, setExpanded] = useState(false);

  const { data: rawData, isLoading, isError } = useGetStockProfile(ticker, {
    query: {
      queryKey: getGetStockProfileQueryKey(ticker),
      staleTime: 1000 * 60 * 30,
    },
  });
  const data = rawData as ProfileData | undefined;

  const description = stockData.description ?? data?.description ?? null;
  const sector = stockData.sector ?? data?.sector ?? null;
  const industry = stockData.industry ?? data?.industry ?? null;
  const website = data?.website ?? null;
  const country = data?.country ?? null;
  const employees = data?.employees ?? null;
  const agreements = data?.agreements ?? [];
  const specialization = data?.specialization;

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

        {/* Company Specialization */}
        {isLoading ? (
          <div className="pt-3 border-t border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <Skeleton className="w-3.5 h-3.5 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-14 w-full rounded-lg" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
              </div>
            </div>
          </div>
        ) : isError ? (
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2.5 rounded-lg border border-border/50">
              <AlertCircle className="w-4 h-4" />
              <span>לא ניתן לטעון את ההתמחות כרגע. הנתונים הכלליים של החברה עדיין זמינים.</span>
            </div>
          </div>
        ) : specialization && (
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">התמחות עסקית</span>
              </div>
              {specialization.status === 'available' && (
                <Badge variant="outline" className={`text-[10px] font-medium border-border/50 ${
                  specialization.confidence === 'high' ? 'bg-positive/10 text-positive border-positive/20' :
                  specialization.confidence === 'medium' ? 'bg-chart-4/10 text-chart-4 border-chart-4/20' :
                  specialization.confidence === 'low' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                  'bg-muted text-muted-foreground'
                }`}>
                  אמינות {
                    specialization.confidence === 'high' ? 'גבוהה' : 
                    specialization.confidence === 'medium' ? 'בינונית' : 
                    specialization.confidence === 'low' ? 'נמוכה' : 'לא ידועה'
                  }
                </Badge>
              )}
            </div>

            {specialization.status === 'insufficient_data' ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2.5 rounded-lg border border-border/50">
                <HelpCircle className="w-4 h-4" />
                <span>אין מספיק נתונים לקביעת התמחות ברורה.</span>
              </div>
            ) : specialization.status === 'unavailable' ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2.5 rounded-lg border border-border/50">
                <AlertCircle className="w-4 h-4" />
                <span>ניתוח התמחות אינו זמין כרגע.</span>
              </div>
            ) : (
              <div className="space-y-3">
                {specialization.primaryProduct && (
                  <div className="bg-primary/5 border border-primary/10 rounded-lg p-2.5">
                    <span className="text-xs font-medium text-primary block mb-1">מוצר/שירות עיקרי</span>
                    <p className="text-sm font-semibold text-foreground">{specialization.primaryProduct}</p>
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {specialization.offerings && specialization.offerings.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground block mb-1.5">היצע מרכזי</span>
                      <ul className="space-y-1.5">
                        {specialization.offerings.map((offering, idx) => (
                          <li key={idx} className="flex items-start gap-1.5 text-xs text-foreground/80">
                            <CheckCircle2 className="w-3.5 h-3.5 text-positive shrink-0 mt-0.5" />
                            <span>{offering}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {specialization.customerMarkets && specialization.customerMarkets.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground block mb-1.5">שווקי יעד</span>
                      <div className="flex flex-wrap gap-1.5">
                        {specialization.customerMarkets.map((market, idx) => (
                          <Badge key={idx} variant="secondary" className="text-[10px] bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors">
                            {market}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {specialization.keywords && specialization.keywords.length > 0 && (
                  <div className="pt-1">
                    <div className="flex flex-wrap gap-1">
                      {specialization.keywords.map((kw, idx) => (
                        <span key={idx} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50">
                          #{kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {specialization.source && (
                  <p className="text-[10px] text-muted-foreground/80 pt-1">
                    מקור: תיאור החברה ב־Yahoo Finance, מסוכם באמצעות AI
                  </p>
                )}
              </div>
            )}
          </div>
        )}

      </CardContent>
    </Card>
  );
}
