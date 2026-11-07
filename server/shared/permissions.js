/**
 * Every permission a person in a business can hold, grouped the way the
 * Staff screen shows them. Read by the server (to work out what someone may
 * do) and by the app (to draw the permission grid), so the two never disagree.
 *
 * A few keys are broad ones the app started with ("stock", "prices",
 * "customers", ...). Each still means what it always did, and also stands
 * for the finer permissions listed under it in EXPANDS: anyone who held
 * "stock" before keeps stock in, adjustments, counts and transfers. That
 * keeps every existing role and stored grant working unchanged, while the
 * owner can now take any single one of those finer permissions away.
 */
export const PERMISSION_GROUPS = [
  {
    key: "sales", label: "Sales",
    perms: [
      { key: "sales", label: "Make sales at the till" },
      { key: "sales_view", label: "See everyone's sales history" },
      { key: "void_sales", label: "Cancel sales and reverse payments" },
      { key: "returns", label: "Process returns" },
      { key: "approve_returns", label: "Approve or reject returns" },
    ],
  },
  {
    key: "inventory", label: "Inventory",
    perms: [
      { key: "inventory_view", label: "See stock levels and movements" },
      { key: "products_add", label: "Add products" },
      { key: "products_edit", label: "Edit products and prices" },
      { key: "products_delete", label: "Delete products" },
      { key: "stock_in", label: "Receive stock (stock in)" },
      { key: "stock_adjust", label: "Adjust stock and record waste" },
      { key: "stock_count", label: "Do stock counts" },
      { key: "transfers", label: "Move stock between branches" },
      { key: "inventory_export", label: "Export inventory" },
      { key: "stock", label: "Suppliers and trade stock work (batches, production, serials, cold room)" },
      { key: "prices", label: "Set trade prices (rooms, services, courses, plans)" },
    ],
  },
  {
    key: "customers", label: "Customers and invoices",
    perms: [
      { key: "customers", label: "Manage customers" },
      { key: "invoices", label: "Create and edit invoices" },
      { key: "invoice_payments", label: "Record invoice payments" },
      { key: "invoices_void", label: "Cancel invoices and remove payments" },
    ],
  },
  {
    key: "expenses", label: "Expenses",
    perms: [
      { key: "expenses", label: "See and record expenses" },
      { key: "expenses_edit", label: "Edit expenses" },
      { key: "expenses_delete", label: "Delete expenses" },
    ],
  },
  {
    key: "finance", label: "Dashboard and finance",
    perms: [
      { key: "dashboard_ops", label: "See the dashboard and business reports" },
      { key: "costs", label: "See product costs" },
      { key: "dashboard_finance", label: "See profit and loss" },
    ],
  },
  {
    key: "staff", label: "Staff",
    perms: [
      { key: "activity", label: "See their own activity" },
      { key: "staff_view", label: "See the staff list" },
      { key: "staff_mgmt", label: "Add and edit staff, PINs and shifts" },
      { key: "staff_perms", label: "Change staff permissions" },
    ],
  },
  {
    key: "admin", label: "Administration",
    perms: [
      { key: "settings", label: "Change business settings" },
      { key: "audit", label: "See the audit log" },
      { key: "support", label: "Manage support tickets" },
    ],
  },
];

/** Every permission key, in grid order. */
export const ALL_PERMS = PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => p.key));

/** A broad permission also brings the finer ones it has always covered. */
export const EXPANDS = {
  prices: ["products_add", "products_edit", "products_delete"],
  stock: ["inventory_view", "stock_in", "stock_adjust", "stock_count", "transfers", "inventory_export"],
  dashboard_ops: ["sales_view", "inventory_view", "inventory_export"],
  customers: ["invoices", "invoice_payments"],
  void_sales: ["invoices_void"],
  expenses: ["expenses_edit", "expenses_delete"],
  staff_mgmt: ["staff_view", "staff_perms"],
  dashboard_finance: ["costs"],
};

/** The permissions a list stands for, broad ones opened up into their finer parts. */
export function expandPerms(perms) {
  const out = new Set(perms);
  for (const p of perms) for (const c of EXPANDS[p] || []) out.add(c);
  return [...out];
}
