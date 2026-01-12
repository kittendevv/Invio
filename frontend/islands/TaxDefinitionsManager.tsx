import { useState } from "preact/hooks";
import { LuPencil, LuPlus, LuTrash2 } from "../components/icons.tsx";

type TaxDefinition = {
  id: string;
  code: string;
  name: string;
  percent: number;
  countryCode?: string;
  isActive?: boolean;
};

type Props = {
  taxDefinitions: TaxDefinition[];
  demoMode?: boolean;
};

export default function TaxDefinitionsManager(props: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    percent: "",
    countryCode: "",
  });

  const handleAdd = () => {
    setEditingId(null);
    setFormData({ code: "", name: "", percent: "", countryCode: "" });
    setShowForm(true);
  };

  const handleEdit = (tax: TaxDefinition) => {
    setEditingId(tax.id);
    setFormData({
      code: tax.code,
      name: tax.name,
      percent: String(tax.percent),
      countryCode: tax.countryCode || "",
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ code: "", name: "", percent: "", countryCode: "" });
  };

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold">Tax definitions</h3>
        <button
          type="button"
          onClick={handleAdd}
          class="btn btn-sm btn-primary"
          disabled={props.demoMode}
        >
          <LuPlus size={16} class="mr-1" />
          Add tax
        </button>
      </div>

      {showForm && (
        <form
          method="post"
          action={editingId
            ? `/api/v1/tax-definitions/${editingId}`
            : "/api/v1/tax-definitions"}
          class="card bg-base-200 p-4 space-y-3"
        >
          {editingId && <input type="hidden" name="_method" value="PUT" />}

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="form-control">
              <div class="label">
                <span class="label-text">Tax code *</span>
              </div>
              <input
                type="text"
                name="code"
                value={formData.code}
                onInput={(e) =>
                  setFormData({
                    ...formData,
                    code: (e.target as HTMLInputElement).value,
                  })}
                class="input input-bordered w-full"
                placeholder="e.g., GST, HST, PST"
                required
                disabled={props.demoMode}
              />
            </label>

            <label class="form-control">
              <div class="label">
                <span class="label-text">Display name *</span>
              </div>
              <input
                type="text"
                name="name"
                value={formData.name}
                onInput={(e) =>
                  setFormData({
                    ...formData,
                    name: (e.target as HTMLInputElement).value,
                  })}
                class="input input-bordered w-full"
                placeholder="e.g., Goods and Services Tax"
                required
                disabled={props.demoMode}
              />
            </label>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="form-control">
              <div class="label">
                <span class="label-text">Rate (%) *</span>
              </div>
              <input
                type="number"
                name="percent"
                value={formData.percent}
                onInput={(e) =>
                  setFormData({
                    ...formData,
                    percent: (e.target as HTMLInputElement).value,
                  })}
                class="input input-bordered w-full"
                step="0.01"
                min="0"
                required
                disabled={props.demoMode}
              />
            </label>

            <label class="form-control">
              <div class="label">
                <span class="label-text">Country code</span>
              </div>
              <input
                type="text"
                name="countryCode"
                value={formData.countryCode}
                onInput={(e) =>
                  setFormData({
                    ...formData,
                    countryCode: (e.target as HTMLInputElement).value,
                  })}
                class="input input-bordered w-full"
                placeholder="e.g., CA"
                maxLength={2}
                disabled={props.demoMode}
              />
            </label>
          </div>

          <div class="flex gap-2">
            <button
              type="submit"
              class="btn btn-primary"
              disabled={props.demoMode}
            >
              {editingId ? "Update" : "Create"}
            </button>
            <button type="button" onClick={handleCancel} class="btn btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div class="space-y-2">
        {props.taxDefinitions.length === 0
          ? (
            <div class="text-center py-6 text-base-content/60">
              No tax definitions yet.
            </div>
          )
          : props.taxDefinitions.map((tax) => (
            <div
              key={tax.id}
              class="flex items-center justify-between p-3 border border-base-300 rounded-box bg-base-100"
            >
              <div class="flex-1">
                <div class="font-medium">
                  {tax.code} — {tax.name}
                </div>
                <div class="text-sm text-base-content/60">
                  {tax.percent}%
                  {tax.countryCode ? ` • ${tax.countryCode}` : ""}
                </div>
              </div>
              <div class="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleEdit(tax)}
                  class="btn btn-sm btn-ghost"
                  disabled={props.demoMode}
                  title="Edit"
                >
                  <LuPencil size={16} />
                </button>
                <form
                  method="post"
                  action={`/api/v1/tax-definitions/${tax.id}`}
                  onSubmit={(e) => {
                    if (
                      !confirm(`Delete ${tax.code}? This cannot be undone.`)
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="_method" value="DELETE" />
                  <button
                    type="submit"
                    class="btn btn-sm btn-ghost text-error"
                    disabled={props.demoMode}
                    title="Delete"
                  >
                    <LuTrash2 size={16} />
                  </button>
                </form>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
