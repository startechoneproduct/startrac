import type { TourStep } from "@/components/tour/ProductTour";

/**
 * Step lists for the two "home" screens (owner/manager Dashboard, staff
 * StaffHome) — see ProductTour.tsx for the engine. Kept here rather than
 * inline so the wording lives in one obvious place, and split by screen
 * because a till-only staff account never sees half of this nav.
 */
export function buildDashboardTour(_t: { pos: string; products: string }): TourStep[] {
  return [
    {
      target: "center",
      title: "Welcome to StarTrack",
      body: "A two-minute look at where everything lives. Skip anytime — you can take this again from the button next to Refresh.",
    },
    {
      target: "nav-pos",
      title: "Sales",
      body: `Sales: ring up a sale, look back at past sales and handle returns. Anything specific to your trade (rooms, jobs, the kitchen) sits under Operations.`,
      placement: "right",
    },
    {
      target: "new-sale-btn",
      title: "New Sale",
      body: "The fastest way in, from any screen in the app.",
      placement: "right",
    },
    {
      target: "nav-products",
      title: "Inventory",
      body: "Your catalog, stock levels and counts. Buying stock in and suppliers sit under Purchases.",
      placement: "right",
    },
    {
      target: "dashboard-tabs",
      title: "This dashboard",
      body: "Today's numbers by default — the tabs switch to expenses, inventory, movement, customers and staff without leaving the page.",
      placement: "bottom",
    },
    {
      target: "dashboard-stats",
      title: "Today, at a glance",
      body: "Revenue, profit and transactions, with the trend against the last 7 days right underneath.",
      placement: "bottom",
    },
    {
      target: "topbar-search",
      title: "Search",
      body: "Ctrl/Cmd + K jumps here from anywhere, and Enter takes you straight to the matching product.",
      placement: "bottom",
    },
    {
      target: "topbar-notifications",
      title: "Alerts",
      body: "Low stock, expiring items and pending returns land here first — before anyone has to notice on their own.",
      placement: "bottom",
    },
    {
      target: "nav-settings",
      title: "Settings",
      body: "Business profile, currency, staff and permissions — and if you ever add a second shop, switching between them lives here too.",
      placement: "right",
    },
    {
      target: "sidebar-help",
      title: "Stuck? Ask here",
      body: "Till codes, keyboard shortcuts, common questions, or a direct line to us.",
      placement: "right",
    },
    {
      target: "center",
      title: "That's the whole map",
      body: "Nothing here is fragile — go click around. Restart this tour anytime from the header above.",
    },
  ];
}

export function buildStaffHomeTour(): TourStep[] {
  return [
    {
      target: "center",
      title: "Welcome to StarTrack",
      body: "A quick look at your own home screen. Skip anytime, or take this again later from the button up top.",
    },
    {
      target: "nav-pos",
      title: "Sell",
      body: "Your till. This is where most of your day happens.",
      placement: "right",
    },
    {
      target: "staffhome-clock",
      title: "Clock in / out",
      body: "Your hours for today, tracked right from here — no separate app.",
      placement: "bottom",
    },
    {
      target: "staffhome-tasks",
      title: "Your tasks",
      body: "Anything a manager has assigned you shows up here, with the urgent ones flagged.",
      placement: "top",
    },
    {
      target: "staffhome-schedule",
      title: "Your schedule",
      body: "Upcoming shifts, so there's never a guess about when you're next in.",
      placement: "left",
    },
    {
      target: "sidebar-help",
      title: "Stuck? Ask here",
      body: "Keyboard shortcuts, common questions, or a direct line to us.",
      placement: "right",
    },
    {
      target: "center",
      title: "That's everything",
      body: "You're set — go sell something.",
    },
  ];
}
