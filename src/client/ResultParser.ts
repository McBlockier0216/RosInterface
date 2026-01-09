import { kebabToCamel, isNumeric, parseBoolean } from '../utils/Helpers';

/**
 * ResultParser.ts
 * Responsible for transforming raw MikroTik API responses into strict JavaScript objects.
 * Features:
 * - Converts property keys from kebab-case to camelCase.
 * - Auto-converts string numbers to JS numbers.
 * - Auto-converts "true"/"false"/"yes"/"no" to JS booleans.
 */
export class ResultParser {

    /**
     * Parses an array of raw objects received from the MikroTik Client.
     * @param rawData The array of objects (usually from !re sentences).
     * @returns A new array with clean keys and typed values.
     */
    public static parse(rawData: any[]): any[] {
        return rawData.map(item => ResultParser.parseItem(item));
    }

    /**
     * Parses a single item/row.
     */
    private static parseItem(item: any): any {
        const cleanItem: any = {};

        for (const key of Object.keys(item)) {
            const value = item[key];

            // 1. Clean the Key
            // Remove the dot from ".id" or ".nextid"
            let newKey = key.startsWith('.') ? key.substring(1) : key;
            // Convert "address-list" -> "addressList"
            newKey = kebabToCamel(newKey);

            // 2. Clean the Value (Type Inference)
            cleanItem[newKey] = ResultParser.inferType(value);
        }

        return cleanItem;
    }

    /**
     * Infers the JavaScript type from the string value.
     */
    private static inferType(value: string): string | number | boolean {
        // Check for Boolean
        const boolVal = parseBoolean(value);
        if (boolVal !== null) return boolVal;

        // Check for Number (but avoid converting IP addresses or mac addresses)
        // Regex checks if it contains only digits (and optionally a dot for decimals/versions)
        // We must be careful not to convert "1.1.1.1" (IP) to a number.
        // Simple rule: Is it numeric AND doesn't have multiple dots?
        if (isNumeric(value) && (value.match(/\./g) || []).length <= 1) {
            // Edge case: Version numbers like "6.48.6" have 2 dots, so they stay strings.
            // Edge case: IP addresses have 3 dots, so they stay strings.
            return parseFloat(value);
        }

        // Return as String
        return value;
    }
}