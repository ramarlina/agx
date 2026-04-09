"use client";

import Script from "next/script";
import gaConfig from "@/config/google-analytics.json";

const GA_MEASUREMENT_ID = gaConfig.measurementId;
const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

export function GoogleAnalytics() {
  return (
    <>
      <Script
        async
        src={GA_SCRIPT_URL}
        strategy="afterInteractive"
      />
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `,
        }}
      />
    </>
  );
}
