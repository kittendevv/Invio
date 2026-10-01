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

  for (const [key, raw] of Object.entries(data)) {
    // Treat explicit empty strings for certain keys as clearing the setting
    const shouldClear = [
      "companyTaxId",
      "taxId", // alias that may slip through
      "companyPhone",
      "phone", // alias
      "companyEmail",
      "email", // alias
      "companyCountryCode",
      "countryCode", // alias
      "companyCity",
      "companyPostalCode",
      "locale",
      "invoiceFallbackLocale",
    ].includes(key) && String(raw).trim() === "";

    if (shouldClear) {
      // delete the setting row if present
      db.query("DELETE FROM settings WHERE key = ?", [
        key === "taxId" ? "companyTaxId" : key,
      ]);
      results.push({ key: key === "taxId" ? "companyTaxId" : key, value: "" });
      continue;
    }

    const value = String(raw);
    // Upsert the setting
    const existing = db.query("SELECT * FROM settings WHERE key = ?", [key]);
    if (existing.length > 0) {
      db.query("UPDATE settings SET value = ? WHERE key = ?", [value, key]);
    } else {
      db.query("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
    }
    results.push({ key, value });
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
