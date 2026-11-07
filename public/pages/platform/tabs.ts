// Sections of the platform console. Each one is its own URL (/admin/<key>) so
// a section can be bookmarked and the back button works.
export const ADMIN_TABS = [
  { key: "overview", label: "Overview", overseerOnly: false },
  { key: "accounts", label: "Accounts", overseerOnly: false },
  { key: "businesses", label: "Businesses", overseerOnly: false },
  { key: "subscriptions", label: "Subscriptions", overseerOnly: false },
  { key: "users", label: "People", overseerOnly: false },
  { key: "activity", label: "Activity", overseerOnly: false },
  { key: "support", label: "Support", overseerOnly: false },
  { key: "team", label: "Team", overseerOnly: true },
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number]["key"];

export const isAdminTab = (v: string | undefined): v is AdminTab => ADMIN_TABS.some((t) => t.key === v);
