import React from 'react';
import path from 'path';
import { GoogleAnalytics } from '@/components/GoogleAnalytics';

describe('GoogleAnalytics', () => {
  it('component is exported and can be imported', () => {
    expect(GoogleAnalytics).toBeDefined();
    expect(typeof GoogleAnalytics).toBe('function');
  });

  it('component renders without throwing errors', () => {
    expect(() => {
      GoogleAnalytics();
    }).not.toThrow();
  });

  it('component returns valid React element', () => {
    const result = GoogleAnalytics();
    expect(result).toBeDefined();
    expect(result.type).toBeDefined(); // Should be a fragment or component
  });

  it('is properly integrated in root layout', async () => {
    // Verify the component is imported in the root layout
    const layoutPath = path.resolve(__dirname, '..', '..', 'app', 'layout.tsx');
    const fs = require('fs');
    const layoutContent = fs.readFileSync(layoutPath, 'utf-8');

    expect(layoutContent).toContain('GoogleAnalytics');
    expect(layoutContent).toContain('import { GoogleAnalytics }');
    expect(layoutContent).toContain('<GoogleAnalytics />');
  });

  it('references config measurement ID and config file has expected value', async () => {
    const fs = require('fs');
    const componentPath = path.resolve(__dirname, '..', '..', 'components', 'GoogleAnalytics.tsx');
    const componentContent = fs.readFileSync(componentPath, 'utf-8');
    const gaConfig = require('../../config/google-analytics.json');

    expect(gaConfig.measurementId).toBe('G-DVQQG95LNL');
    expect(componentContent).toContain('gaConfig.measurementId');
    expect(componentContent).toContain('GA_MEASUREMENT_ID');
  });

  it('uses Next.js Script component with afterInteractive strategy', async () => {
    const componentPath = path.resolve(__dirname, '..', '..', 'components', 'GoogleAnalytics.tsx');
    const fs = require('fs');
    const componentContent = fs.readFileSync(componentPath, 'utf-8');

    expect(componentContent).toContain('import Script from "next/script"');
    expect(componentContent).toContain('strategy="afterInteractive"');
    expect(componentContent.match(/strategy="afterInteractive"/g)).toHaveLength(2);
  });

  it('initializes dataLayer correctly', async () => {
    const componentPath = path.resolve(__dirname, '..', '..', 'components', 'GoogleAnalytics.tsx');
    const fs = require('fs');
    const componentContent = fs.readFileSync(componentPath, 'utf-8');

    expect(componentContent).toContain('window.dataLayer = window.dataLayer || []');
    expect(componentContent).toContain('function gtag()');
    expect(componentContent).toContain('gtag(\'js\', new Date())');
    expect(componentContent).toContain('gtag(\'config\'');
  });
});
