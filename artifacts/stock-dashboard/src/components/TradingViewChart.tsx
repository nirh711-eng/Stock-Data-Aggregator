import { useEffect, useRef } from "react";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TradingView: any;
  }
}

interface TradingViewChartProps {
  ticker: string;
  height?: number;
}

export function TradingViewChart({ ticker, height = 450 }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<unknown>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    widgetRef.current = null;

    const uniqueId = `tv_widget_${ticker}_${Date.now()}`;
    const innerDiv = document.createElement("div");
    innerDiv.id = uniqueId;
    container.appendChild(innerDiv);

    const initWidget = () => {
      if (!window.TradingView || !document.getElementById(uniqueId)) return;
      widgetRef.current = new window.TradingView.widget({
        autosize: true,
        symbol: ticker,
        interval: "D",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        backgroundColor: "rgba(10, 10, 15, 1)",
        gridColor: "rgba(40, 40, 60, 0.8)",
        enable_publishing: false,
        allow_symbol_change: false,
        save_image: false,
        hide_side_toolbar: false,
        withdateranges: true,
        range: "3M",
        container_id: uniqueId,
        studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies"],
        show_popup_button: true,
        popup_width: "1000",
        popup_height: "650",
      });
    };

    const existingScript = document.getElementById("tradingview-tv-js");
    if (existingScript && window.TradingView) {
      initWidget();
    } else if (existingScript) {
      existingScript.addEventListener("load", initWidget);
    } else {
      const script = document.createElement("script");
      script.id = "tradingview-tv-js";
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    }

    return () => {
      if (container) container.innerHTML = "";
      widgetRef.current = null;
    };
  }, [ticker]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: "100%" }}
      className="rounded-lg overflow-hidden"
    />
  );
}
