/**
 * Helpers.ts
 * Utility functions for string manipulation and type checking.
 */

/**
 * Converts a kebab-case string (e.g., "address-list") to camelCase (e.g., "addressList").
 */
export function kebabToCamel(str: string): string {
    return str.replace(/-./g, (x) => x[1].toUpperCase());
}

/**
 * Converts a camelCase string to kebab-case (useful for command builders).
 */
export function camelToKebab(str: string): string {
    return str.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`);
}

/**
 * Checks if a string represents a valid number.
 */
export function isNumeric(str: string): boolean {
    if (typeof str !== "string") return false;
    return !isNaN(parseFloat(str)) && isFinite(Number(str));
}

/**
 * Standardizes boolean values from MikroTik (yes/no/true/false) to JS booleans.
 */
export function parseBoolean(value: string): boolean | null {
    if (value === 'true' || value === 'yes') return true;
    if (value === 'false' || value === 'no') return false;
    return null; // Not a boolean
}