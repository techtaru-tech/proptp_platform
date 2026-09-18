/**
 * What the sales team asks every buyer. Kept as plain lists rather than enums in the database:
 * these are labels on a dropdown and the team renames them faster than a migration can follow.
 */

export const PURPOSE_OPTIONS = ['Investment', 'Residential', '2nd Home'];

export const PROPERTY_TYPE_OPTIONS = ['Plot', 'Villa', 'Flat', 'Farmland'];

export const BUDGET_RANGE_OPTIONS = [
  'Below ₹20L',
  '₹20L – ₹30L',
  '₹30L – ₹40L',
  '₹40L – ₹50L',
  '₹50L – ₹75L',
  '₹75L – ₹1Cr',
  '₹1Cr+',
];

export const PREFERRED_LOCATION_OPTIONS = [
  'Tonk Road',
  'Ajmer Road',
  'Agra Road',
  'Kalwar Road',
  'Sikar Road',
  'Delhi Road',
  'Jaipur — other',
];

/** Turns a list into Select options with a blank "not asked yet" entry at the top. */
export function asOptions(values: string[], placeholder: string) {
  return [{ value: '', label: placeholder }, ...values.map((value) => ({ value, label: value }))];
}
