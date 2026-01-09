/**
 * A generic wrapper around MikroTik result arrays to provide O(1) lookups,
 * advanced grouping, pagination, and efficient sorting algorithms.
 *
 * @template T The type of the items in the collection (usually a MikroTik resource interface).
 */
export class MikrotikCollection<T extends Record<string, any>> {
    private readonly _items: T[];

    /**
     * Creates a new instance of MikrotikCollection.
     * @param items The raw array of data received from the router.
     */
    constructor(items: T[]) {
        this._items = items;
    }

    // ==========================================
    // OUTPUT FINALIZERS (JSON Friendly)
    // ==========================================

    /**
     * Returns the raw underlying array.
     * Standard output for JSON responses.
     */
    public toArray(): T[] {
        return this._items;
    }

    /**
     * Alias for `toArray()`.
     * Provides a familiar syntax for developers coming from other frameworks.
     */
    public toList(): T[] {
        return this._items;
    }

    /**
     * Returns the current instance.
     * Useful for maintaining chain consistency in promises.
     */
    public toCollection(): this {
        return this;
    }

    /**
     * Converts the collection into a plain Object (Dictionary) indexed by a specific key.
     * Useful for O(1) lookups on the frontend.
     *
     * @param key The property to use as the index (e.g., 'name', '.id').
     * @returns A plain object where keys are the property values.
     */
    public toMap(key: keyof T): Record<string, T> {
        return this._items.reduce((acc, item) => {
            const indexValue = String(item[key]);
            acc[indexValue] = item;
            return acc;
        }, {} as Record<string, T>);
    }

    /**
     * Groups items into a plain Object where keys are values of the specified property.
     * Ideal for generating reports or charts (e.g., grouping users by 'profile').
     *
     * @param field The property to group by.
     * @returns A plain object where keys are the group names and values are arrays of items.
     */
    public toGrouped(field: keyof T): Record<string, T[]> {
        return this._items.reduce((groups, item) => {
            const groupKey = String(item[field]);
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(item);
            return groups;
        }, {} as Record<string, T[]>);
    }

    /**
     * Performs in-memory pagination on the results.
     *
     * @param page The current page number (1-based index).
     * @param pageSize The number of items per page.
     * @returns A subset of the original array for the requested page.
     */
    public toPages(page: number, pageSize: number): T[] {
        if (page < 1) page = 1;
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        return this._items.slice(start, end);
    }

    // ==========================================
    // ACCESSORS AND HELPERS
    // ==========================================

    /**
     * Returns the first item in the collection or null if empty.
     */
    public first(): T | null {
        return this._items.length > 0 ? this._items[0] : null;
    }

    /**
     * Returns the last item in the collection or null if empty.
     */
    public last(): T | null {
        return this._items.length > 0 ? this._items[this._items.length - 1] : null;
    }

    /**
     * Returns the total number of items in the collection.
     */
    public count(): number {
        return this._items.length;
    }

    /**
     * Converts the collection into a native JavaScript Map.
     * More efficient for massive internal lookups but not automatically serializable to JSON.
     *
     * @param key The property to use as the Map key.
     */
    public keyBy(key: keyof T): Map<string, T> {
        const map = new Map<string, T>();
        for (const item of this._items) {
            map.set(String(item[key]), item);
        }
        return map;
    }

    /**
     * Groups items into a Map where values are new MikrotikCollection instances.
     * Allows chaining further operations on specific groups.
     *
     * @param key The property to group by.
     */
    public groupBy(key: keyof T): Map<string, MikrotikCollection<T>> {
        const map = new Map<string, T[]>();

        for (const item of this._items) {
            const groupValue = String(item[key]);
            if (!map.has(groupValue)) {
                map.set(groupValue, []);
            }
            map.get(groupValue)!.push(item);
        }

        const collectionMap = new Map<string, MikrotikCollection<T>>();
        for (const [k, v] of map) {
            collectionMap.set(k, new MikrotikCollection(v));
        }

        return collectionMap;
    }

    // ==========================================
    // SORTING AND FILTERING ALGORITHMS
    // ==========================================

    /**
     * Filters the collection using a predicate function.
     * @param predicate A function that accepts an item and returns true to keep it.
     * @returns A new MikrotikCollection instance with the filtered items.
     */
    public filter(predicate: (item: T) => boolean): MikrotikCollection<T> {
        return new MikrotikCollection(this._items.filter(predicate));
    }

    /**
     * Sorts the collection by a specific key using Timsort (Node.js default).
     * Handles both numbers and strings (case-insensitive) correctly.
     *
     * @param key The property to sort by.
     * @param direction 'asc' (ascending) or 'desc' (descending).
     */
    public sortBy(key: keyof T, direction: 'asc' | 'desc' = 'asc'): this {
        this._items.sort((a, b) => {
            const valA = a[key];
            const valB = b[key];

            // Numeric Sort
            if (typeof valA === 'number' && typeof valB === 'number') {
                return direction === 'asc' ? valA - valB : valB - valA;
            }

            // String Sort (Case Insensitive)
            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();

            if (strA < strB) return direction === 'asc' ? -1 : 1;
            if (strA > strB) return direction === 'asc' ? 1 : -1;
            return 0;
        });

        return this;
    }

    /**
     * Specifically sorts IP addresses numerically.
     * Solves the issue where "10.0.0.2" comes after "10.0.0.10" in standard string sort.
     * Handles CIDR notation (e.g., 192.168.1.1/24) automatically.
     */
    public sortByIp(key: keyof T, direction: 'asc' | 'desc' = 'asc'): this {
        this._items.sort((a, b) => {
            const ipA = String(a[key]);
            const ipB = String(b[key]);

            const numA = this.ipToLong(ipA);
            const numB = this.ipToLong(ipB);

            return direction === 'asc' ? numA - numB : numB - numA;
        });
        return this;
    }


    /**
     * Converts an IPv4 string into a long integer for accurate numerical comparison.
     * @param ip The IP address string (e.g., "192.168.1.1" or "10.5.5.0/24").
     */
    private ipToLong(ip: string): number {
        if (!ip || ip.trim() === '') return 0;
        const cleanIp = ip.split('/')[0]; // Remove CIDR suffix
        return cleanIp.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }
}