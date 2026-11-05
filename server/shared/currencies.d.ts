export interface CurrencyInfo { code: string; symbol: string; name: string }

export const CURRENCIES: CurrencyInfo[];
export const DEFAULT_CURRENCY: CurrencyInfo;
export function findCurrency(value: unknown): CurrencyInfo | null;
export function currencyCodeOf(settings: { currency?: string; currencyCode?: string } | null | undefined): string;
