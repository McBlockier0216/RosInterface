export declare class MikrotikCollection<T extends Record<string, any>> {
    private readonly _items;
    constructor(items: T[]);
    toArray(): T[];
    toList(): T[];
    toCollection(): this;
    toMap(key: keyof T): Record<string, T>;
    toGrouped(field: keyof T): Record<string, T[]>;
    toPages(page: number, pageSize: number): T[];
    first(): T | null;
    last(): T | null;
    count(): number;
    keyBy(key: keyof T): Map<string, T>;
    groupBy(key: keyof T): Map<string, MikrotikCollection<T>>;
    filter(predicate: (item: T) => boolean): MikrotikCollection<T>;
    sortBy(key: keyof T, direction?: 'asc' | 'desc'): this;
    sortByIp(key: keyof T, direction?: 'asc' | 'desc'): this;
    private ipToLong;
}
