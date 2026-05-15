-- Business/Seller information (stored in settings)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Insert default business settings
INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('companyName', 'Your Company'),
  ('companyAddress', '123 Business St, City, State 12345'),
  ('companyEmail', 'contact@yourcompany.com'),
  ('companyPhone', '+1 (555) 123-4567'),
  ('companyTaxId', 'TAX123456789'),
  ('companyCountryCode', 'US'),
  ('currency', 'USD'),
  ('logo', ''),
  ('paymentMethods', 'Bank Transfer, PayPal, Credit Card'),
  ('bankAccount', 'Account: 1234567890, Routing: 987654321'),
  ('paymentTerms', 'Due in 30 days'),
  ('defaultNotes', 'Thank you for your business!'),
  ('postalCityFormat', 'auto'),
  -- Optional default invoice number pattern (tokens: {YYYY} {YY} {MM} {DD} {DATE} {RAND4})
  ('invoiceNumberPattern', ''),
  ('invoiceNumberingEnabled', 'true'),
  ('allowProtectedInvoiceChanges', 'false'),
  ('embedXmlInHtml', 'false'),
  -- Optional PEPPOL endpoint configuration (leave empty if not applicable)
  ('peppolSellerEndpointId', ''),
  ('peppolSellerEndpointSchemeId', ''),
  ('peppolBuyerEndpointId', ''),
  ('peppolBuyerEndpointSchemeId', '');

-- Enhanced customers table
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  country_code TEXT,
  tax_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced invoices table
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  issue_date DATE NOT NULL,
  due_date DATE,
  currency TEXT DEFAULT 'USD',
  status TEXT CHECK(status IN ('draft', 'sent', 'complete', 'paid', 'overdue', 'voided')) DEFAULT 'draft',
  
  -- Totals
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  discount_percentage NUMERIC DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL,
  
  -- Payment and notes
  payment_terms TEXT,
  notes TEXT,
  
  -- System fields
  share_token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced invoice items table
CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT,
  unit_price NUMERIC NOT NULL,
  line_total NUMERIC NOT NULL,
  notes TEXT,
  sort_order INTEGER DEFAULT 0
);

-- Invoice attachments (optional)
CREATE TABLE invoice_attachments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Templates table
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  html TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  template_type TEXT DEFAULT 'builtin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- No built-in default template is seeded here; startup code installs maintained templates.

-- Add template_type column if not exists (for existing databases)
ALTER TABLE templates ADD COLUMN template_type TEXT DEFAULT 'builtin';

-- Index for performance
CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_share_token ON invoices(share_token);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

-- Normalized tax schema (for complex/composite taxes)
CREATE TABLE IF NOT EXISTS tax_definitions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT,
  percent NUMERIC NOT NULL,
  category_code TEXT,
  country_code TEXT,
  vendor_specific_id TEXT,
  default_included BOOLEAN DEFAULT 0,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_item_taxes (
  id TEXT PRIMARY KEY,
  invoice_item_id TEXT NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
  tax_definition_id TEXT REFERENCES tax_definitions(id),
  percent NUMERIC NOT NULL,
  taxable_amount NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  included BOOLEAN NOT NULL DEFAULT 0,
  sequence INTEGER DEFAULT 0,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_taxes (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tax_definition_id TEXT REFERENCES tax_definitions(id),
  percent NUMERIC NOT NULL,
  taxable_amount NUMERIC NOT NULL,
  tax_amount NUMERIC NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoice-level flags for tax pricing/rounding
ALTER TABLE invoices ADD COLUMN prices_include_tax BOOLEAN DEFAULT 0;
ALTER TABLE invoices ADD COLUMN rounding_mode TEXT DEFAULT 'line';

-- Products table for reusable invoice items
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  sku TEXT,
  unit TEXT DEFAULT 'piece',
  category TEXT,
  tax_definition_id TEXT REFERENCES tax_definitions(id),
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Link invoice items to products (optional reference)
ALTER TABLE invoice_items ADD COLUMN product_id TEXT REFERENCES products(id);
ALTER TABLE invoice_items ADD COLUMN unit TEXT;

-- Add 'voided' to invoice status CHECK constraint.
-- SQLite CHECK constraints are immutable, but adding 'voided' via a direct
-- UPDATE is safe because the original CREATE TABLE in this file already
-- includes 'voided'. For databases created before this migration we accept
-- the value through a permissive write (SQLite does NOT enforce CHECK on
-- existing rows; and the updated CREATE TABLE definition above already
-- includes 'voided' for fresh installs).

-- =============================================
-- Multi-user system: users & permissions
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  two_factor_secret TEXT,
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  two_factor_recovery_codes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_recovery_codes TEXT;

CREATE TABLE IF NOT EXISTS user_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, resource, action)
);

ALTER TABLE users ADD COLUMN oidc_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_subject ON users(oidc_subject) WHERE oidc_subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
