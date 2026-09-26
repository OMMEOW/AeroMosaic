const cell = (v: unknown) => {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  return /[",\n#]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv<T>(rows: T[], columns: { key: string; get: (r: T) => unknown }[]): string {
  return [columns.map((c) => c.key).join(","), ...rows.map((r) => columns.map((c) => cell(c.get(r))).join(","))].join("\n");
}
