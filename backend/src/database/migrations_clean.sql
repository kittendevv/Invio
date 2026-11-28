-- Drop existing tables to recreate with new schema
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS invoice_attachments;

-- Business/Seller information (stored in settings)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Enhanced customers table
CREATE TABLE customers (
-- No seed rows here; built-in templates are inserted during app startup.
  email TEXT,
  address TEXT,
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
  status TEXT CHECK(status IN ('draft', 'sent', 'complete', 'paid', 'overdue', 'voided', 'accepted', 'declined')) DEFAULT 'draft',
  
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default business settings
INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('companyName', 'Your Company'),
  ('companyAddress', '123 Business St, City, State 12345'),
  ('companyEmail', 'contact@yourcompany.com'),
  ('companyPhone', '+1 (555) 123-4567'),
  ('companyTaxId', 'TAX123456789'),
  ('currency', 'USD'),
  ('logo', ''),
  ('paymentMethods', 'Bank Transfer, PayPal, Credit Card'),
  ('bankAccount', 'Account: 1234567890, Routing: 987654321'),
  ('paymentTerms', 'Due in 30 days'),
  ('defaultNotes', 'Thank you for your business!'),
  ('allowProtectedInvoiceChanges', 'false');

-- Insert a simple default template
INSERT OR IGNORE INTO templates (id, name, html, is_default) VALUES 
('default-template', 'Default Invoice Template', '<h1>Invoice #{{invoiceNumber}}</h1><p>Total: {{currency}} {{total}}</p>', TRUE);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- Multi-user system: users & permissions
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

CREATE TABLE IF NOT EXISTS user_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
