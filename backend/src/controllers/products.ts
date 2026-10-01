/**
 * Products Controller
 * CRUD operations for product management.
 * Products can be selected when creating invoices to auto-fill line items.
 */
import { getDatabase } from "../database/init.ts";
import { CreateProductRequest, Product } from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";

const PRODUCT_COLUMNS =
  "id, name, description, unit_price, sku, unit, category, tax_definition_id, is_active, created_at, updated_at, hs_code, country_of_origin, length_mm, width_mm, height_mm, weight_g";

const toOptionalNumber = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

const mapRowToProduct = (row: unknown[]): Product => ({
  id: row[0] as string,
  name: row[1] as string,
  description: (row[2] ?? undefined) as string | undefined,
  unitPrice: Number(row[3]) || 0,
  sku: (row[4] ?? undefined) as string | undefined,
  unit: (row[5] ?? "piece") as string,
  category: (row[6] ?? undefined) as string | undefined,
  taxDefinitionId: (row[7] ?? undefined) as string | undefined,
  isActive: Boolean(row[8]),
  createdAt: new Date(row[9] as string),
  updatedAt: new Date(row[10] as string),
  hsCode: (row[11] ?? undefined) as string | undefined,
  countryOfOrigin: (row[12] ?? undefined) as string | undefined,
  lengthMm: toOptionalNumber(row[13]),
  widthMm: toOptionalNumber(row[14]),
  heightMm: toOptionalNumber(row[15]),
  weightG: toOptionalNumber(row[16]),
});

const toNullable = (v?: string | null): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

/** Non-negative number or null (empty, invalid and negative values are dropped). */
const toNullableNumber = (v?: number | string | null): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const toCountryCode = (v?: string | null): string | null =>
  toNullable(v)?.toUpperCase() ?? null;

export const getProducts = (includeInactive = false): Product[] => {
  const db = getDatabase();
  const query = includeInactive
    ? `SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY name ASC`
    : `SELECT ${PRODUCT_COLUMNS} FROM products WHERE is_active = 1 ORDER BY name ASC`;
  const results = db.query(query) as unknown[][];
  return results.map((row: unknown[]) => mapRowToProduct(row));
};

export const getProductById = (id: string): Product | null => {
  const db = getDatabase();
  const results = db.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?`,
    [id],
  ) as unknown[][];
  if (results.length === 0) return null;
  return mapRowToProduct(results[0] as unknown[]);
};

export const createProduct = (data: CreateProductRequest): Product => {
  const db = getDatabase();
  const productId = generateUUID();
  const now = new Date();

  const description = toNullable(data.description);
  const sku = toNullable(data.sku);
  const unit = toNullable(data.unit) || "piece";
  const category = toNullable(data.category);
  const taxDefinitionId = toNullable(data.taxDefinitionId);
  const hsCode = toNullable(data.hsCode);
  const countryOfOrigin = toCountryCode(data.countryOfOrigin);
  const lengthMm = toNullableNumber(data.lengthMm);
  const widthMm = toNullableNumber(data.widthMm);
  const heightMm = toNullableNumber(data.heightMm);
  const weightG = toNullableNumber(data.weightG);

  db.query(
    `INSERT INTO products (id, name, description, unit_price, sku, unit, category, tax_definition_id, is_active, created_at, updated_at,
       hs_code, country_of_origin, length_mm, width_mm, height_mm, weight_g)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productId,
      data.name,
      description,
      data.unitPrice || 0,
      sku,
      unit,
      category,
      taxDefinitionId,
      now.toISOString(),
      now.toISOString(),
      hsCode,
      countryOfOrigin,
      lengthMm,
      widthMm,
      heightMm,
      weightG,
    ],
  );

  return {
    id: productId,
    name: data.name,
    description: description ?? undefined,
    unitPrice: data.unitPrice || 0,
    sku: sku ?? undefined,
    unit: unit,
    category: category ?? undefined,
    taxDefinitionId: taxDefinitionId ?? undefined,
    hsCode: hsCode ?? undefined,
    countryOfOrigin: countryOfOrigin ?? undefined,
    lengthMm: lengthMm ?? undefined,
    widthMm: widthMm ?? undefined,
    heightMm: heightMm ?? undefined,
    weightG: weightG ?? undefined,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
};

export const updateProduct = (
  id: string,
  data: Partial<CreateProductRequest> & { isActive?: boolean },
): Product | null => {
  const db = getDatabase();
  const existing = getProductById(id);
  if (!existing) return null;

  const now = new Date();

  const name = data.name ?? existing.name;
  const description =
    data.description !== undefined
      ? toNullable(data.description)
      : existing.description ?? null;
  const unitPrice =
    data.unitPrice !== undefined ? data.unitPrice : existing.unitPrice;
  const sku =
    data.sku !== undefined ? toNullable(data.sku) : existing.sku ?? null;
  const unit =
    data.unit !== undefined
      ? toNullable(data.unit) || "piece"
      : existing.unit ?? "piece";
  const category =
    data.category !== undefined
      ? toNullable(data.category)
      : existing.category ?? null;
  const taxDefinitionId =
    data.taxDefinitionId !== undefined
      ? toNullable(data.taxDefinitionId)
      : existing.taxDefinitionId ?? null;
  const hsCode =
    data.hsCode !== undefined
      ? toNullable(data.hsCode)
      : existing.hsCode ?? null;
  const countryOfOrigin =
    data.countryOfOrigin !== undefined
      ? toCountryCode(data.countryOfOrigin)
      : existing.countryOfOrigin ?? null;
  const lengthMm =
    data.lengthMm !== undefined
      ? toNullableNumber(data.lengthMm)
      : existing.lengthMm ?? null;
  const widthMm =
    data.widthMm !== undefined
      ? toNullableNumber(data.widthMm)
      : existing.widthMm ?? null;
  const heightMm =
    data.heightMm !== undefined
      ? toNullableNumber(data.heightMm)
      : existing.heightMm ?? null;
  const weightG =
    data.weightG !== undefined
      ? toNullableNumber(data.weightG)
      : existing.weightG ?? null;
  const isActive =
    data.isActive !== undefined ? data.isActive : existing.isActive;

  db.query(
    `UPDATE products SET
      name = ?, description = ?, unit_price = ?, sku = ?, unit = ?, category = ?, tax_definition_id = ?, is_active = ?, updated_at = ?,
      hs_code = ?, country_of_origin = ?, length_mm = ?, width_mm = ?, height_mm = ?, weight_g = ?
     WHERE id = ?`,
    [
      name,
      description,
      unitPrice,
      sku,
      unit,
      category,
      taxDefinitionId,
      isActive ? 1 : 0,
      now.toISOString(),
      hsCode,
      countryOfOrigin,
      lengthMm,
      widthMm,
      heightMm,
      weightG,
      id,
    ],
  );

  return getProductById(id);
};

export const deleteProduct = (productId: string): void => {
  const db = getDatabase();
  const existing = getProductById(productId);
  if (!existing) {
    throw new Error("Product not found");
  }

  // Soft-delete: set is_active = false
  db.query(
    `UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), productId],
  );
};

export const isProductUsedInInvoices = (productId: string): boolean => {
  const db = getDatabase();
  const results = db.query(
    "SELECT COUNT(*) FROM invoice_items WHERE product_id = ?",
    [productId],
  ) as unknown[][];
  return Number(results[0]?.[0] ?? 0) > 0;
};

export const reactivateProduct = (productId: string): Product | null => {
  const db = getDatabase();
  const existing = getProductById(productId);
  if (!existing) return null;

  db.query(
    `UPDATE products SET is_active = 1, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), productId],
  );

  return getProductById(productId);
};
