/**
 * ProductOptionsManager Island
 * Settings UI for managing product categories and units.
 * Allows CRUD operations with deletion protection for items in use.
 */
import { useState } from "preact/hooks";
import {
  LuAlertTriangle,
  LuPencil,
  LuPlus,
  LuTrash2,
} from "../components/icons.tsx";

type ProductCategory = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isBuiltin: boolean;
};

type ProductUnit = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isBuiltin: boolean;
};

type Props = {
  categories: ProductCategory[];
  units: ProductUnit[];
  demoMode?: boolean;
};

export default function ProductOptionsManager(props: Props) {
  const [categories, setCategories] = useState(props.categories);
  const [units, setUnits] = useState(props.units);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState({ code: "", name: "" });
  const [unitForm, setUnitForm] = useState({ code: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Category handlers
  const handleAddCategory = () => {
    setEditingCategoryId(null);
    setCategoryForm({ code: "", name: "" });
    setShowCategoryForm(true);
    setError(null);
  };

  const handleEditCategory = (cat: ProductCategory) => {
    setEditingCategoryId(cat.id);
    setCategoryForm({ code: cat.code, name: cat.name });
    setShowCategoryForm(true);
    setError(null);
  };

  const handleCancelCategory = () => {
    setShowCategoryForm(false);
    setEditingCategoryId(null);
    setCategoryForm({ code: "", name: "" });
    setError(null);
  };

  const handleSaveCategory = async () => {
    if (!categoryForm.code.trim() || !categoryForm.name.trim()) {
      setError("Code and name are required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = editingCategoryId
        ? `/api/v1/product-categories/${editingCategoryId}`
        : "/api/v1/product-categories";
      const method = editingCategoryId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(categoryForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save category");
      }
      const saved = await res.json();
      if (editingCategoryId) {
        setCategories((cats) => cats.map((c) => c.id === saved.id ? saved : c));
      } else {
        setCategories((cats) => [...cats, saved]);
      }
      handleCancelCategory();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCategory = async (cat: ProductCategory) => {
    if (cat.isBuiltin) {
      setError("Cannot delete built-in category");
      return;
    }
    if (!confirm(`Delete category "${cat.name}"? This cannot be undone.`)) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/product-categories/${cat.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete category");
      }
      setCategories((cats) => cats.filter((c) => c.id !== cat.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Unit handlers
  const handleAddUnit = () => {
    setEditingUnitId(null);
    setUnitForm({ code: "", name: "" });
    setShowUnitForm(true);
    setError(null);
  };

  const handleEditUnit = (unit: ProductUnit) => {
    setEditingUnitId(unit.id);
    setUnitForm({ code: unit.code, name: unit.name });
    setShowUnitForm(true);
    setError(null);
  };

  const handleCancelUnit = () => {
    setShowUnitForm(false);
    setEditingUnitId(null);
    setUnitForm({ code: "", name: "" });
    setError(null);
  };

  const handleSaveUnit = async () => {
    if (!unitForm.code.trim() || !unitForm.name.trim()) {
      setError("Code and name are required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = editingUnitId
        ? `/api/v1/product-units/${editingUnitId}`
        : "/api/v1/product-units";
      const method = editingUnitId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unitForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save unit");
      }
      const saved = await res.json();
      if (editingUnitId) {
        setUnits((us) => us.map((u) => u.id === saved.id ? saved : u));
      } else {
        setUnits((us) => [...us, saved]);
      }
      handleCancelUnit();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUnit = async (unit: ProductUnit) => {
    if (unit.isBuiltin) {
      setError("Cannot delete built-in unit");
      return;
    }
    if (!confirm(`Delete unit "${unit.name}"? This cannot be undone.`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/product-units/${unit.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete unit");
      }
      setUnits((us) => us.filter((u) => u.id !== unit.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="space-y-6">
      {error && (
        <div class="alert alert-error">
          <LuAlertTriangle size={20} />
          <span>{error}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Categories Section */}
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold">Product Categories</h3>
          <button
            type="button"
            onClick={handleAddCategory}
            class="btn btn-sm btn-primary"
            disabled={props.demoMode || loading}
          >
            <LuPlus size={16} class="mr-1" />
            Add category
          </button>
        </div>

        {showCategoryForm && (
          <div class="card bg-base-200 p-4 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">Code *</span>
                </div>
                <input
                  type="text"
                  value={categoryForm.code}
                  onInput={(e) =>
                    setCategoryForm({
                      ...categoryForm,
                      code: (e.target as HTMLInputElement).value,
                    })}
                  class="input input-bordered w-full"
                  placeholder="e.g., electronics"
                  disabled={props.demoMode || loading}
                />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">Name *</span>
                </div>
                <input
                  type="text"
                  value={categoryForm.name}
                  onInput={(e) =>
                    setCategoryForm({
                      ...categoryForm,
                      name: (e.target as HTMLInputElement).value,
                    })}
                  class="input input-bordered w-full"
                  placeholder="e.g., Electronics"
                  disabled={props.demoMode || loading}
                />
              </label>
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                onClick={handleSaveCategory}
                class="btn btn-primary"
                disabled={props.demoMode || loading}
              >
                {loading
                  ? "Saving..."
                  : (editingCategoryId ? "Update" : "Create")}
              </button>
              <button
                type="button"
                onClick={handleCancelCategory}
                class="btn btn-ghost"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div class="space-y-2">
          {categories.length === 0
            ? (
              <div class="text-center py-6 text-base-content/60">
                No categories yet.
              </div>
            )
            : categories.map((cat) => (
              <div
                key={cat.id}
                class="flex items-center justify-between p-3 border border-base-300 rounded-box bg-base-100"
              >
                <div class="flex-1">
                  <div class="font-medium">{cat.name}</div>
                  <div class="text-sm text-base-content/60">
                    {cat.code}
                    {cat.isBuiltin && (
                      <span class="badge badge-ghost badge-sm ml-2">
                        Built-in
                      </span>
                    )}
                  </div>
                </div>
                <div class="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEditCategory(cat)}
                    class="btn btn-sm btn-ghost"
                    disabled={props.demoMode || loading}
                    title="Edit"
                  >
                    <LuPencil size={16} />
                  </button>
                  {!cat.isBuiltin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(cat)}
                      class="btn btn-sm btn-ghost text-error"
                      disabled={props.demoMode || loading}
                      title="Delete"
                    >
                      <LuTrash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      <div class="divider"></div>

      {/* Units Section */}
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold">Product Units</h3>
          <button
            type="button"
            onClick={handleAddUnit}
            class="btn btn-sm btn-primary"
            disabled={props.demoMode || loading}
          >
            <LuPlus size={16} class="mr-1" />
            Add unit
          </button>
        </div>

        {showUnitForm && (
          <div class="card bg-base-200 p-4 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">Code *</span>
                </div>
                <input
                  type="text"
                  value={unitForm.code}
                  onInput={(e) =>
                    setUnitForm({
                      ...unitForm,
                      code: (e.target as HTMLInputElement).value,
                    })}
                  class="input input-bordered w-full"
                  placeholder="e.g., pack"
                  disabled={props.demoMode || loading}
                />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">Name *</span>
                </div>
                <input
                  type="text"
                  value={unitForm.name}
                  onInput={(e) =>
                    setUnitForm({
                      ...unitForm,
                      name: (e.target as HTMLInputElement).value,
                    })}
                  class="input input-bordered w-full"
                  placeholder="e.g., Pack"
                  disabled={props.demoMode || loading}
                />
              </label>
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                onClick={handleSaveUnit}
                class="btn btn-primary"
                disabled={props.demoMode || loading}
              >
                {loading ? "Saving..." : (editingUnitId ? "Update" : "Create")}
              </button>
              <button
                type="button"
                onClick={handleCancelUnit}
                class="btn btn-ghost"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div class="space-y-2">
          {units.length === 0
            ? (
              <div class="text-center py-6 text-base-content/60">
                No units yet.
              </div>
            )
            : units.map((unit) => (
              <div
                key={unit.id}
                class="flex items-center justify-between p-3 border border-base-300 rounded-box bg-base-100"
              >
                <div class="flex-1">
                  <div class="font-medium">{unit.name}</div>
                  <div class="text-sm text-base-content/60">
                    {unit.code}
                    {unit.isBuiltin && (
                      <span class="badge badge-ghost badge-sm ml-2">
                        Built-in
                      </span>
                    )}
                  </div>
                </div>
                <div class="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEditUnit(unit)}
                    class="btn btn-sm btn-ghost"
                    disabled={props.demoMode || loading}
                    title="Edit"
                  >
                    <LuPencil size={16} />
                  </button>
                  {!unit.isBuiltin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteUnit(unit)}
                      class="btn btn-sm btn-ghost text-error"
                      disabled={props.demoMode || loading}
                      title="Delete"
                    >
                      <LuTrash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
