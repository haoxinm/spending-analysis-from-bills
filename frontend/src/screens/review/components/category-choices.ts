import type { Category, CategoryChoice } from "../types";

/** A category's first non-pending, non-merged subcategory — the default target for its digit. */
function defaultSubcategoryFor(category: Category): CategoryChoice["subcategoryKey"] | undefined {
  const sameKey = category.subcategories.find(
    (sub) => sub.key === category.key && !sub.pending && sub.merged_into == null,
  );
  if (sameKey) return sameKey.key;
  const firstActive = category.subcategories.find((sub) => !sub.pending && sub.merged_into == null);
  return firstActive?.key;
}

/**
 * Builds the numbered quick-pick list: one entry per category, in taxonomy order, capped at 9
 * (the digit keys `1`-`9`, §P3-B). A plain function, not exported from `category-picker.tsx`
 * alongside its component: `index.tsx`'s keydown handler needs it too (to map a digit to a
 * choice without duplicating this logic), and a module that exports both a component and a
 * plain function trips `react-refresh/only-export-components` for real — Fast Refresh can't
 * tell which part of the module changed.
 */
export function buildCategoryChoices(categories: Category[]): CategoryChoice[] {
  const choices: CategoryChoice[] = [];
  for (const category of categories) {
    const subcategoryKey = defaultSubcategoryFor(category);
    if (!subcategoryKey) continue; // a category with no active subcategory has nothing to pick
    const subcategoryLabel =
      category.subcategories.find((sub) => sub.key === subcategoryKey)?.name ?? subcategoryKey;
    choices.push({
      categoryKey: category.key,
      categoryLabel: category.name,
      subcategoryKey,
      subcategoryLabel,
    });
    if (choices.length === 9) break;
  }
  return choices;
}
