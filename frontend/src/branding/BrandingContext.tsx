import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../lib/api';

export interface Branding {
  restaurantName: string;
  restaurantLogo: string | null;
  currency: string;
}

const FALLBACK: Branding = {
  restaurantName: 'City Square',
  restaurantLogo: null,
  currency: 'TZS',
};

interface BrandingState {
  branding: Branding;
  refreshBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingState>({
  branding: FALLBACK,
  refreshBranding: async () => {},
});

// Bundled mark shown until the restaurant uploads its own logo.
export const DEFAULT_LOGO = '/logo.png';

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(FALLBACK);

  const refreshBranding = useCallback(async () => {
    const res = await apiFetch<Branding>('/settings/branding');
    if (res.ok && res.data) setBranding(res.data);
  }, []);

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  return (
    <BrandingContext.Provider value={{ branding, refreshBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingState {
  return useContext(BrandingContext);
}
