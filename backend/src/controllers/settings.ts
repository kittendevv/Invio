import { getDatabase } from "../database/init.ts";
import { Setting } from "../types/index.ts";

export const getSettings = () => {
  const db = getDatabase();
  const results = db.query("SELECT * FROM settings");
  return results.map((row: unknown[]) => ({
    key: row[0] as string,
    value: row[1] as string,
  }));
};

export const updateSettings = (data: Record<string, string>) => {
  const db = getDatabase();
  const results: Setting[] = [];
  // Normalize legacy/frontend alias keys to canonical settings table keys.
  const canonicalKey = (key: string) =>
    ({
      taxId: "companyTaxId",
      phone: "companyPhone",
      email: "companyEmail",
      countryCode: "companyCountryCode",
    })[key] ?? key;
  const clearableKeys = new Set([
    "companyTaxId",
    "companyPhone",
    "companyEmail",
    "companyCountryCode",
    "companyCity",
    "companyPostalCode",
    "locale",
  ]);

  for (const [key, raw] of Object.entries(data)) {
    const targetKey = canonicalKey(key);
    // Treat explicit empty strings for certain keys as clearing the setting
    const shouldClear = clearableKeys.has(targetKey) && String(raw).trim() === "";

    const value = shouldClear ? "" : String(raw);
    // Upsert the setting
    const existing = db.query("SELECT * FROM settings WHERE key = ?", [targetKey]);
    if (existing.length > 0) {
      db.query("UPDATE settings SET value = ? WHERE key = ?", [value, targetKey]);
    } else {
      db.query("INSERT INTO settings (key, value) VALUES (?, ?)", [targetKey, value]);
    }
    results.push({ key: targetKey, value });
  }

  return results;
};

export const getSetting = (key: string) => {
  const db = getDatabase();
  const result = db.query("SELECT value FROM settings WHERE key = ?", [key]);
  return result.length > 0 ? result[0][0] : null;
};

export const setSetting = (key: string, value: string) => {
  const db = getDatabase();
  const existing = db.query("SELECT * FROM settings WHERE key = ?", [key]);

  if (existing.length > 0) {
    db.query("UPDATE settings SET value = ? WHERE key = ?", [value, key]);
  } else {
    db.query("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
  }

  return { key, value };
};

export const deleteSetting = (key: string) => {
  const db = getDatabase();
  db.query("DELETE FROM settings WHERE key = ?", [key]);
  return { key } as Pick<Setting, "key">;
};
