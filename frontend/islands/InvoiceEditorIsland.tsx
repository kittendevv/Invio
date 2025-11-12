import type { JSX } from "preact";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { LuGripVertical, LuPlus, LuSave } from "../components/icons.tsx";
import { formatMoney } from "../utils/format.ts";

type Customer = { id: string; name: string; defaultHourlyRate?: number };
type RateModifier = {
  id: string;
  name: string;
  multiplier: number;
  description: string;
  isDefault: boolean;
};
type IncomingItem = {
  description: string;
  quantity?: number; // Keep for backward compatibility
  unitPrice?: number; // Keep for backward compatibility
  hours?: number;
  rate?: number;
  rateModifierId?: string;
  distance?: number;
  notes?: string;
  taxPercent?: number;
};

export type InvoiceEditorProps = {
  mode: "create" | "edit";
  customers?: Customer[];
  selectedCustomerId?: string;
  customerName?: string;
  currency?: string;
  status?: "draft" | "sent" | "paid" | "overdue";
  invoiceNumber?: string;
  invoiceNumberPrefill?: string;
  taxRate?: number;
  pricesIncludeTax?: boolean;
  roundingMode?: string;
  taxMode?: "invoice" | "line";
  notes?: string;
  paymentTerms?: string;
  items: IncomingItem[];
  showDates?: boolean;
  issueDate?: string;
  dueDate?: string;
  demoMode?: boolean;
  invoiceNumberError?: string;
  numberFormat?: string;
  hideTopButton?: boolean;
  formId?: string;
};

type ItemState = {
  id: string;
  description: string;
  hours: string;
  rate: string;
  rateModifierId: string;
  distance: string;
  notes: string;
  taxPercent: string;
};

type InlineCustomer = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  taxId: string;
  countryCode: string;
};

let itemIdCounter = 0;

function nextItemId(): string {
  itemIdCounter += 1;
  return `invoice-item-${Date.now()}-${itemIdCounter}`;
}

function mapItem(item?: IncomingItem): ItemState {
  return {
    id: nextItemId(),
    description: item?.description ?? "",
    hours: item?.hours !== undefined ? String(item.hours) : 
           item?.quantity !== undefined ? String(item.quantity) : "0", // Backward compatibility
    rate: item?.rate !== undefined ? String(item.rate) : 
          item?.unitPrice !== undefined ? String(item.unitPrice) : "0", // Backward compatibility
    rateModifierId: item?.rateModifierId ?? "", // Will be set to default after modifiers load
    distance: item?.distance !== undefined ? String(item.distance) : "",
    notes: item?.notes ?? "",
    taxPercent: item && typeof item.taxPercent === "number"
      ? String(item.taxPercent)
      : "",
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const blankInlineCustomer: InlineCustomer = {
  name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  postalCode: "",
  taxId: "",
  countryCode: "",
};

export default function InvoiceEditorIsland(props: InvoiceEditorProps) {
  const numberFormat = props.numberFormat === "period" ? "period" : "comma";
  const initialItems = props.items && props.items.length > 0
    ? props.items.map((item) => mapItem(item))
    : [mapItem()];
  const [items, setItems] = useState<ItemState[]>(initialItems);

  const initialCustomerSelection = (() => {
    if (props.mode === "create") {
      if (props.selectedCustomerId) return props.selectedCustomerId;
      if (!props.customers || props.customers.length === 0) return "__create__";
      return "";
    }
    return props.selectedCustomerId ?? "";
  })();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    initialCustomerSelection,
  );
  const [inlineCustomer, setInlineCustomer] = useState<InlineCustomer>({
    ...blankInlineCustomer,
  });
  const [invoiceNumber, setInvoiceNumber] = useState(
    props.invoiceNumber ?? props.invoiceNumberPrefill ?? "",
  );
  const [currency, setCurrency] = useState(props.currency ?? "USD");
  const [status, setStatus] = useState<
    "draft" | "sent" | "paid" | "overdue"
  >(props.status ?? "draft");
  const [issueDate, setIssueDate] = useState(
    props.issueDate ??
      (props.showDates ? new Date().toISOString().slice(0, 10) : ""),
  );
  const [dueDate, setDueDate] = useState(props.dueDate ?? "");
  const [paymentTerms, setPaymentTerms] = useState(props.paymentTerms ?? "");
  const [notes, setNotes] = useState(props.notes ?? "");
  const [taxMode, setTaxMode] = useState<"invoice" | "line">(
    props.taxMode ?? "invoice",
  );
  const [invoiceTaxRate, setInvoiceTaxRate] = useState(
    typeof props.taxRate === "number" ? String(props.taxRate) : "0",
  );
  const [pricesIncludeTax, setPricesIncludeTax] = useState<"true" | "false">(
    props.pricesIncludeTax ? "true" : "false",
  );
  const [roundingMode, setRoundingMode] = useState<"line" | "total">(
    props.roundingMode === "total" ? "total" : "line",
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<
    { id: string; position: "before" | "after" } | null
  >(null);
  
  // Time-based billing state
  const [rateModifiers, setRateModifiers] = useState<RateModifier[]>([]);
  const [mileageRate, setMileageRate] = useState<number>(0.70); // Default federal rate
  const [defaultModifierId, setDefaultModifierId] = useState<string>("");

  const formRef = useRef<HTMLFormElement>(null);

  const isCreateMode = props.mode === "create";
  const isDemo = !!props.demoMode;

  // Reset items when server-side data changes (e.g. after validation errors).
  useEffect(() => {
    const next = props.items && props.items.length > 0
      ? props.items.map((item) => mapItem(item))
      : [mapItem()];
    setItems(next);
  }, [props.items]);

  // Load rate modifiers on mount
  useEffect(() => {
    async function loadRateModifiers() {
      try {
        const response = await fetch("/api/v1/rate-modifiers");
        if (response.ok) {
          const modifiers: RateModifier[] = await response.json();
          setRateModifiers(modifiers);
          const defaultMod = modifiers.find(m => m.isDefault);
          if (defaultMod) {
            setDefaultModifierId(defaultMod.id);
            // Update items that don't have a modifier set
            setItems(prev => prev.map(item => 
              item.rateModifierId === "" ? { ...item, rateModifierId: defaultMod.id } : item
            ));
          }
        }
      } catch (error) {
        console.error("Failed to load rate modifiers:", error);
      }
    }
    loadRateModifiers();
  }, []);

  // Load mileage rate setting on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/v1/settings");
        if (response.ok) {
          const settings = await response.json();
          // Settings API returns object with key-value pairs, not array
          if (settings.mileageRate) {
            setMileageRate(parseFloat(settings.mileageRate));
          }
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    }
    loadSettings();
  }, []);

  const handleAddItem = useCallback(() => {
    const newItem = mapItem();
    // Set default modifier if available
    if (defaultModifierId) {
      newItem.rateModifierId = defaultModifierId;
    }
    // Set customer's default hourly rate if available
    const customer = props.customers?.find(c => c.id === selectedCustomerId);
    if (customer && customer.defaultHourlyRate) {
      newItem.rate = String(customer.defaultHourlyRate);
    }
    setItems((prev) => [...prev, newItem]);
  }, [defaultModifierId, props.customers, selectedCustomerId]);

  const handleRemoveItem = useCallback((id: string) => {
    setItems((prev) => {
      if (prev.length <= 1) {
        return [mapItem()];
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const handleItemChange = useCallback(
    (index: number, field: keyof ItemState) => (event: Event) => {
      const target = event.currentTarget as
        | HTMLInputElement
        | HTMLTextAreaElement;
      const value = target.value;
      setItems((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    [],
  );

  const handleCustomerChange = useCallback((event: Event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    setSelectedCustomerId(value);
    if (value !== "__create__") {
      setInlineCustomer({ ...blankInlineCustomer });
      // Auto-fill rate from customer's default
      const customer = props.customers?.find(c => c.id === value);
      if (customer && customer.defaultHourlyRate) {
        setItems(prev => prev.map(item => ({
          ...item,
          rate: String(customer.defaultHourlyRate)
        })));
      }
    }
  }, [props.customers]);

  const handleInlineCustomerChange = useCallback(
    (field: keyof InlineCustomer) => (event: Event) => {
      const value = (event.currentTarget as
        | HTMLInputElement
        | HTMLTextAreaElement).value;
      setInlineCustomer((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const hasItemWithDescription = useMemo(
    () => items.some((item) => item.description.trim().length > 0),
    [items],
  );
  const inlineCustomerRequired =
    isCreateMode && selectedCustomerId === "__create__";
  const customerError = isCreateMode && !inlineCustomerRequired &&
      !selectedCustomerId
    ? "Please select a customer."
    : undefined;
  const inlineCustomerError = inlineCustomerRequired &&
      !inlineCustomer.name.trim()
    ? "Customer name is required."
    : undefined;
  const itemsError = hasItemWithDescription
    ? undefined
    : "Add at least one item with a description.";
  const isValid = !itemsError && !customerError && !inlineCustomerError;

  // Recalculate totals whenever line items or tax settings change.
  const totals = useMemo(() => {
    const includeTax = pricesIncludeTax === "true";
    const invoiceRate = parseFloat(invoiceTaxRate) || 0;
    let subtotal = 0;
    let tax = 0;

    items.forEach((item) => {
      // Time-based billing calculation: (Rate × Hours × Modifier) + (Distance × Mileage Rate)
      const hours = parseFloat(item.hours) || 0;
      const rate = parseFloat(item.rate) || 0;
      const distance = parseFloat(item.distance) || 0;
      
      // Find modifier multiplier
      const modifier = rateModifiers.find(m => m.id === item.rateModifierId);
      const multiplier = modifier ? modifier.multiplier : 1.0;
      
      // Calculate line total
      const basePay = rate * hours * multiplier;
      const mileagePay = distance * mileageRate;
      let lineTotal = basePay + mileagePay;
      
      if (roundingMode === "line") {
        lineTotal = round2(lineTotal);
      }

      if (taxMode === "line") {
        const lineRate = parseFloat(item.taxPercent) || 0;
        if (includeTax && lineRate > 0) {
          const divisor = 1 + lineRate / 100;
          if (divisor > 0) {
            const lineTax = lineTotal - lineTotal / divisor;
            tax += lineTax;
            subtotal += lineTotal - lineTax;
          } else {
            subtotal += lineTotal;
          }
        } else if (!includeTax && lineRate > 0) {
          const lineTax = lineTotal * (lineRate / 100);
          tax += lineTax;
          subtotal += lineTotal;
        } else {
          subtotal += lineTotal;
        }
      } else {
        subtotal += lineTotal;
      }
    });

    if (taxMode === "invoice") {
      if (includeTax && invoiceRate > 0) {
        const divisor = 1 + invoiceRate / 100;
        if (divisor > 0) {
          const extracted = subtotal - subtotal / divisor;
          tax = extracted;
          subtotal = subtotal - extracted;
        }
      } else if (!includeTax && invoiceRate > 0) {
        tax = subtotal * (invoiceRate / 100);
      } else {
        tax = 0;
      }
    }

    subtotal = round2(subtotal);
    tax = round2(tax);
    const total = round2(subtotal + tax);
    const format = (value: number) =>
      formatMoney(value, currency || "USD", numberFormat);

    return {
      subtotal: format(subtotal),
      tax: format(tax),
      total: format(total),
      rawTax: tax,
    };
  }, [
    currency,
    invoiceTaxRate,
    items,
    numberFormat,
    pricesIncludeTax,
    roundingMode,
    taxMode,
    rateModifiers,
    mileageRate,
  ]);

  const handleDragStart = useCallback(
    (event: DragEvent, id: string) => {
      setDraggedId(id);
      setDropIndicator(null);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (event: DragEvent, id: string) => {
      if (!draggedId || draggedId === id) return;
      event.preventDefault();
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      setDropIndicator({ id, position: after ? "after" : "before" });
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    },
    [draggedId],
  );

  const handleDragLeave = useCallback((id: string) => {
    setDropIndicator((current) =>
      current && current.id === id ? null : current
    );
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent, id: string) => {
      if (!draggedId || draggedId === id) {
        setDropIndicator(null);
        return;
      }
      event.preventDefault();
      setItems((prev) => {
        const next = [...prev];
        const fromIndex = next.findIndex((item) => item.id === draggedId);
        const targetIndex = next.findIndex((item) => item.id === id);
        if (fromIndex === -1 || targetIndex === -1) return prev;
        const [moved] = next.splice(fromIndex, 1);
        let insertIndex = next.findIndex((item) => item.id === id);
        if (insertIndex === -1) return prev;
        const indicator = dropIndicator && dropIndicator.id === id
          ? dropIndicator.position
          : "before";
        if (indicator === "after") insertIndex += 1;
        next.splice(insertIndex, 0, moved);
        return next;
      });
      setDropIndicator(null);
      setDraggedId(null);
    },
    [draggedId, dropIndicator],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropIndicator(null);
  }, []);

  const handleSubmit = useCallback(
    (event: Event) => {
      if (!isValid) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [isValid],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        formRef.current?.requestSubmit();
      } else if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        handleAddItem();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleAddItem]);

  const customerDescribedBy = inlineCustomerRequired
    ? "customer-error inline-customer-error"
    : "customer-error";

  return (
    <form
      ref={formRef}
      method="post"
      class="space-y-6"
      data-writable
      onSubmit={(event) => handleSubmit(event as Event)}
      id={props.formId}
      data-valid={isValid ? "true" : "false"}
    >
      {!props.hideTopButton && (
        <div class="flex items-center justify-end gap-3">
          <button
            type="submit"
            class="btn btn-primary"
            data-writable
            disabled={!isValid}
          >
            <LuSave size={16} />
            <span>Save</span>
          </button>
        </div>
      )}

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="form-control">
          <div class="label">
            <span class="label-text">
              Customer <span aria-hidden="true" class="text-error">*</span>
            </span>
          </div>
          {isCreateMode
            ? (
              <>
                <select
                  name="customerId"
                  class="select select-bordered w-full"
                  value={selectedCustomerId}
                  onInput={handleCustomerChange}
                  disabled={isDemo}
                  aria-required="true"
                  aria-describedby={customerDescribedBy}
                  data-writable
                >
                  <option value="">Select customer</option>
                  {props.customers?.map((customer) => (
                    <option value={customer.id} key={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                  <option value="__create__">Add new customer…</option>
                </select>
                <div
                  id="customer-error"
                  class={`text-error text-xs mt-1 ${customerError ? "" : "hidden"}`}
                >
                  {customerError ?? ""}
                </div>
              </>
            )
            : (
              <div class="space-y-2">
                <input
                  value={props.customerName || ""}
                  class="input input-bordered w-full"
                  disabled
                />
              </div>
            )}
        </div>

        <div class="form-control">
          <div class="label">
            <span class="label-text">Invoice Number</span>
          </div>
          <input
            name="invoiceNumber"
            value={invoiceNumber}
            class="input input-bordered w-full"
            placeholder="e.g. INV-2025-001"
            onInput={(event) =>
              setInvoiceNumber(
                (event.currentTarget as HTMLInputElement).value,
              )}
            data-writable
            disabled={isDemo}
          />
          {props.invoiceNumberError && (
            <div class="text-error text-xs mt-1">
              {props.invoiceNumberError}
            </div>
          )}
        </div>

        <div class="form-control">
          <div class="label">
            <span class="label-text">Currency</span>
          </div>
          <input
            name="currency"
            value={currency}
            class="input input-bordered w-full"
            onInput={(event) =>
              setCurrency((event.currentTarget as HTMLInputElement).value)}
            data-writable
            disabled={isDemo}
          />
        </div>

        <div class="form-control">
          <div class="label">
            <span class="label-text">Status</span>
          </div>
          <select
            name="status"
            class="select select-bordered w-full"
            value={status}
            onInput={(event) =>
              setStatus(
                (event.currentTarget as HTMLSelectElement)
                  .value as "draft" | "sent" | "paid" | "overdue",
              )}
            data-writable
            disabled={isDemo}
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
      </div>

      {inlineCustomerRequired && (
        <div class="rounded-box border border-base-300 bg-base-200/40 p-4 space-y-3">
          <h3 class="text-sm font-semibold">New customer details</h3>
          <div
            id="inline-customer-error"
            class={`text-error text-xs ${inlineCustomerError ? "" : "hidden"}`}
          >
            {inlineCustomerError ?? ""}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="form-control sm:col-span-2">
              <div class="label">
                <span class="label-text">
                  Customer name <span aria-hidden="true" class="text-error">*</span>
                </span>
              </div>
              <input
                name="inlineCustomerName"
                value={inlineCustomer.name}
                onInput={handleInlineCustomerChange("name")}
                class="input input-bordered w-full"
                required
                data-writable
                disabled={isDemo}
                aria-describedby="inline-customer-error"
                placeholder="Acme Corp"
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">Email</span>
              </div>
              <input
                type="email"
                name="inlineCustomerEmail"
                value={inlineCustomer.email}
                onInput={handleInlineCustomerChange("email")}
                class="input input-bordered w-full"
                data-writable
                disabled={isDemo}
                placeholder="billing@example.com"
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">Phone</span>
              </div>
              <input
                name="inlineCustomerPhone"
                value={inlineCustomer.phone}
                onInput={handleInlineCustomerChange("phone")}
                class="input input-bordered w-full"
                data-writable
                disabled={isDemo}
                placeholder="+1 555 0100"
              />
            </label>
            <label class="form-control sm:col-span-2">
              <div class="label">
                <span class="label-text">Address</span>
              </div>
              <textarea
                name="inlineCustomerAddress"
                value={inlineCustomer.address}
                onInput={handleInlineCustomerChange("address")}
                class="textarea textarea-bordered"
                rows={3}
                data-writable
                disabled={isDemo}
                placeholder="123 Main Street"
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">City</span>
              </div>
              <input
                name="inlineCustomerCity"
                value={inlineCustomer.city}
                onInput={handleInlineCustomerChange("city")}
                class="input input-bordered w-full"
                data-writable
                disabled={isDemo}
                placeholder="Amsterdam"
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">Postal code</span>
              </div>
              <input
                name="inlineCustomerPostalCode"
                value={inlineCustomer.postalCode}
                onInput={handleInlineCustomerChange("postalCode")}
                class="input input-bordered w-full"
                data-writable
                disabled={isDemo}
                placeholder="1234 AB"
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">VAT / Tax ID</span>
              </div>
              <input
                name="inlineCustomerTaxId"
                value={inlineCustomer.taxId}
                onInput={handleInlineCustomerChange("taxId")}
                class="input input-bordered w-full"
                data-writable
                disabled={isDemo}
                placeholder="NL123456789B01"
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">Country code</span>
              </div>
              <input
                name="inlineCustomerCountryCode"
                value={inlineCustomer.countryCode}
                onInput={handleInlineCustomerChange("countryCode")}
                class="input input-bordered w-full"
                data-writable
                disabled={isDemo}
                placeholder="NL"
              />
            </label>
          </div>
        </div>
      )}

      {props.showDates && (
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="form-control">
            <div class="label">
              <span class="label-text">Issue Date</span>
            </div>
            <input
              type="date"
              name="issueDate"
              value={issueDate}
              onInput={(event) =>
                setIssueDate((event.currentTarget as HTMLInputElement).value)}
              class="input input-bordered w-full"
              data-writable
              disabled={isDemo}
            />
          </label>
          <label class="form-control">
            <div class="label">
              <span class="label-text">Due Date</span>
            </div>
            <input
              type="date"
              name="dueDate"
              value={dueDate}
              onInput={(event) =>
                setDueDate((event.currentTarget as HTMLInputElement).value)}
              class="input input-bordered w-full"
              data-writable
              disabled={isDemo}
            />
          </label>
        </div>
      )}

      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="block text-sm">
            Items <span aria-hidden="true" class="text-error">*</span>
            <span class="ml-2 text-xs text-base-content/50 font-normal">
              (Ctrl+Enter to add)
            </span>
          </label>
          <button
            type="button"
            id="add-item"
            class="btn btn-sm"
            onClick={handleAddItem}
            data-writable
            disabled={isDemo}
          >
            <LuPlus size={16} />
            <span class="ml-2">Add item</span>
          </button>
        </div>
        <div
          id="items-error"
          class={`text-error text-xs mb-2 ${itemsError ? "" : "hidden"}`}
        >
          {itemsError ?? ""}
        </div>

        <div class="items-header hidden lg:flex flex-row flex-nowrap items-center gap-2 mb-1 text-xs text-base-content/60 font-medium">
          <div class="w-6 shrink-0"></div>
          <div class="flex-1 min-w-0 pl-3">Description</div>
          <div class="w-20 shrink-0 text-center">Hours</div>
          <div class="w-24 shrink-0 text-center">Rate ($/hr)</div>
          <div class="w-32 shrink-0 text-center">Modifier</div>
          <div class="w-20 shrink-0 text-center">Miles</div>
          <div
            class={`w-24 shrink-0 text-center per-line-tax-input ${taxMode === "line" ? "" : "hidden"}`}
          >
            Tax %
          </div>
          <div class="w-32 max-w-xs shrink-0 text-center">Notes</div>
          <div class="w-8 shrink-0"></div>
        </div>

        <div id="items-container" class="space-y-3">
          {items.map((item, index) => {
            const indicator = dropIndicator && dropIndicator.id === item.id
              ? dropIndicator.position
              : null;
            const rowStyle: JSX.CSSProperties | undefined = indicator === "before"
              ? { borderTop: "2px solid hsl(var(--p))" }
              : indicator === "after"
              ? { borderBottom: "2px solid hsl(var(--p))" }
              : undefined;
            return (
              <div
                key={item.id}
                class="item-row"
                draggable
                onDragStart={(event) => handleDragStart(event, item.id)}
                onDragOver={(event) => handleDragOver(event, item.id)}
                onDragLeave={() => handleDragLeave(item.id)}
                onDrop={(event) => handleDrop(event, item.id)}
                onDragEnd={handleDragEnd}
                style={rowStyle}
              >
                {/* Mobile card layout */}
                <div class="lg:hidden border border-base-300 rounded-lg p-3 space-y-2">
                  <div class="flex items-start gap-2">
                    <button
                      type="button"
                      class="drag-handle btn btn-ghost btn-sm btn-square shrink-0 cursor-move opacity-40 hover:opacity-100"
                      aria-label="Drag to reorder"
                      tabIndex={-1}
                    >
                      <LuGripVertical size={16} />
                    </button>
                    <div class="flex-1 space-y-2">
                      <input
                        name={`item_${index}_description`}
                        value={item.description}
                        placeholder="Description *"
                        class="input input-bordered w-full"
                        onInput={handleItemChange(index, "description")}
                        data-writable
                        aria-describedby="items-error"
                      />
                      <div class="grid grid-cols-2 gap-2">
                        <div>
                          <label class="label py-1"><span class="label-text text-xs">Hours</span></label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            name={`item_${index}_hours`}
                            value={item.hours}
                            class="input input-bordered w-full input-sm"
                            onInput={handleItemChange(index, "hours")}
                            data-writable
                          />
                        </div>
                        <div>
                          <label class="label py-1"><span class="label-text text-xs">Rate ($/hr)</span></label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            name={`item_${index}_rate`}
                            value={item.rate}
                            class="input input-bordered w-full input-sm"
                            onInput={handleItemChange(index, "rate")}
                            data-writable
                          />
                        </div>
                      </div>
                      <div class="grid grid-cols-2 gap-2">
                        <div>
                          <label class="label py-1"><span class="label-text text-xs">Modifier</span></label>
                          <select
                            name={`item_${index}_rateModifierId`}
                            value={item.rateModifierId}
                            class="select select-bordered w-full select-sm"
                            onInput={handleItemChange(index, "rateModifierId")}
                            data-writable
                          >
                            {rateModifiers.map(mod => (
                              <option key={mod.id} value={mod.id}>
                                {mod.name} ({mod.multiplier}x)
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label class="label py-1"><span class="label-text text-xs">Miles (optional)</span></label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            name={`item_${index}_distance`}
                            value={item.distance}
                            placeholder="0"
                            class="input input-bordered w-full input-sm"
                            onInput={handleItemChange(index, "distance")}
                            data-writable
                          />
                        </div>
                      </div>
                      {taxMode === "line" && (
                        <div>
                          <label class="label py-1"><span class="label-text text-xs">Tax %</span></label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            name={`item_${index}_tax_percent`}
                            value={item.taxPercent}
                            placeholder="0"
                            class="input input-bordered w-full input-sm per-line-tax-input"
                            onInput={handleItemChange(index, "taxPercent")}
                            data-writable
                            disabled={taxMode !== "line"}
                            title="Per-line tax rate (%)"
                          />
                        </div>
                      )}
                      <input
                        name={`item_${index}_notes`}
                        value={item.notes}
                        placeholder="Notes (optional)"
                        class="input input-bordered w-full input-sm"
                        onInput={handleItemChange(index, "notes")}
                        data-writable
                      />
                    </div>
                    <button
                      type="button"
                      class="remove-item btn btn-ghost btn-square btn-sm shrink-0"
                      aria-label="Remove item"
                      onClick={() => handleRemoveItem(item.id)}
                      data-writable
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Desktop inline layout */}
                <div class="hidden lg:flex flex-nowrap items-center gap-2">
                  <button
                    type="button"
                    class="drag-handle btn btn-ghost btn-sm btn-square shrink-0 cursor-move opacity-40 hover:opacity-100"
                    aria-label="Drag to reorder"
                    tabIndex={-1}
                  >
                    <LuGripVertical size={16} />
                  </button>
                  <input
                    name={`item_${index}_description`}
                    value={item.description}
                    placeholder="Description"
                    class="input input-bordered flex-1 min-w-0"
                    onInput={handleItemChange(index, "description")}
                    data-writable
                    aria-describedby="items-error"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name={`item_${index}_hours`}
                    value={item.hours}
                    placeholder="0"
                    class="input input-bordered w-20 shrink-0"
                    onInput={handleItemChange(index, "hours")}
                    data-writable
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name={`item_${index}_rate`}
                    value={item.rate}
                    placeholder="0"
                    class="input input-bordered w-24 shrink-0"
                    onInput={handleItemChange(index, "rate")}
                    data-writable
                  />
                  <select
                    name={`item_${index}_rateModifierId`}
                    value={item.rateModifierId}
                    class="select select-bordered w-32 shrink-0"
                    onInput={handleItemChange(index, "rateModifierId")}
                    data-writable
                  >
                    {rateModifiers.map(mod => (
                      <option key={mod.id} value={mod.id}>
                        {mod.name} ({mod.multiplier}x)
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name={`item_${index}_distance`}
                    value={item.distance}
                    placeholder="0"
                    class="input input-bordered w-20 shrink-0"
                    onInput={handleItemChange(index, "distance")}
                    data-writable
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name={`item_${index}_tax_percent`}
                    value={item.taxPercent}
                    placeholder="Tax %"
                    class={`input input-bordered w-24 shrink-0 per-line-tax-input ${taxMode === "line" ? "" : "hidden"}`}
                    onInput={handleItemChange(index, "taxPercent")}
                    data-writable
                    disabled={taxMode !== "line"}
                    title="Per-line tax rate (%)"
                  />
                  <input
                    name={`item_${index}_notes`}
                    value={item.notes}
                    placeholder="Notes"
                    class="input input-bordered w-40 max-w-xs shrink-0"
                    onInput={handleItemChange(index, "notes")}
                    data-writable
                  />
                  <button
                    type="button"
                    class="remove-item btn btn-ghost btn-square btn-sm shrink-0"
                    aria-label="Remove item"
                    onClick={() => handleRemoveItem(item.id)}
                    data-writable
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div id="totals-preview" class="bg-base-200 rounded-box p-3 sm:p-4 text-sm">
        <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
          <div class="flex flex-col sm:flex-row gap-3 sm:gap-6">
            <div class="flex justify-between sm:block">
              <span class="text-base-content/60">Subtotal:</span>
              <span class="font-semibold sm:ml-2" id="preview-subtotal">
                {totals.subtotal}
              </span>
            </div>
            <div
              id="preview-tax-container"
              class={Math.abs(totals.rawTax) < 0.005 ? "hidden" : "flex justify-between sm:block"}
            >
              <span class="text-base-content/60">Tax:</span>
              <span class="font-semibold sm:ml-2" id="preview-tax">
                {totals.tax}
              </span>
            </div>
          </div>
          <div class="text-left sm:text-right pt-2 sm:pt-0 border-t sm:border-t-0">
            <span class="text-base-content/60">Total:</span>
            <span class="font-bold text-lg ml-2" id="preview-total">
              {totals.total}
            </span>
          </div>
        </div>
      </div>

      <div class="text-xs text-base-content/50 flex flex-wrap gap-x-4 gap-y-1">
        <span class="hidden sm:inline">
          <kbd class="kbd kbd-xs">Ctrl</kbd>
          +
          <kbd class="kbd kbd-xs">S</kbd>
          Save
        </span>
        <span class="hidden sm:inline">
          <kbd class="kbd kbd-xs">Ctrl</kbd>
          +
          <kbd class="kbd kbd-xs">Enter</kbd>
          Add item
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label class="form-control">
          <div class="label">
            <span class="label-text">Tax Mode</span>
          </div>
          <select
            name="taxMode"
            id="tax-mode-select"
            class="select select-bordered w-full"
            value={taxMode}
            onInput={(event) =>
              setTaxMode(
                (event.currentTarget as HTMLSelectElement)
                  .value as "invoice" | "line",
              )}
            data-writable
            disabled={isDemo}
          >
            <option value="invoice">Invoice total</option>
            <option value="line">Per line</option>
          </select>
        </label>
        <label
          class={`form-control ${taxMode === "invoice" ? "" : "hidden"}`}
        >
          <div class="label">
            <span class="label-text">Tax Rate (%)</span>
          </div>
          <input
            type="number"
            step="0.01"
            min="0"
            name="taxRate"
            value={invoiceTaxRate}
            class="input input-bordered w-full"
            onInput={(event) =>
              setInvoiceTaxRate(
                (event.currentTarget as HTMLInputElement).value,
              )}
            data-writable
            disabled={isDemo || taxMode !== "invoice"}
            id="invoice-tax-rate-input"
          />
        </label>
        <label class="form-control">
          <div class="label">
            <span class="label-text">Prices include tax?</span>
          </div>
          <select
            name="pricesIncludeTax"
            class="select select-bordered w-full"
            value={pricesIncludeTax}
            onInput={(event) =>
              setPricesIncludeTax(
                (event.currentTarget as HTMLSelectElement).value as
                  | "true"
                  | "false",
              )}
            data-writable
            disabled={isDemo}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
        <label class="form-control">
          <div class="label">
            <span class="label-text">Rounding mode</span>
          </div>
          <select
            name="roundingMode"
            class="select select-bordered w-full"
            value={roundingMode}
            onInput={(event) =>
              setRoundingMode(
                (event.currentTarget as HTMLSelectElement)
                  .value === "total"
                  ? "total"
                  : "line",
              )}
            data-writable
            disabled={isDemo}
          >
            <option value="line">Round per line</option>
            <option value="total">Round on totals</option>
          </select>
        </label>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="form-control">
          <div class="label">
            <span class="label-text">Payment Terms</span>
          </div>
          <input
            name="paymentTerms"
            value={paymentTerms}
            placeholder="e.g. Due in 30 days"
            class="input input-bordered w-full"
            onInput={(event) =>
              setPaymentTerms((event.currentTarget as HTMLInputElement).value)}
            data-writable
            disabled={isDemo}
          />
        </label>
        <label class="form-control">
          <div class="label">
            <span class="label-text">Notes</span>
          </div>
          <textarea
            name="notes"
            value={notes}
            class="textarea textarea-bordered"
            rows={3}
            onInput={(event) =>
              setNotes((event.currentTarget as HTMLTextAreaElement).value)}
            data-writable
            disabled={isDemo}
          />
        </label>
      </div>

    </form>
  );
}
