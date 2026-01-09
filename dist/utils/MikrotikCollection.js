"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MikrotikCollection = void 0;
class MikrotikCollection {
    constructor(items) {
        this._items = items;
    }
    toArray() {
        return this._items;
    }
    toList() {
        return this._items;
    }
    toCollection() {
        return this;
    }
    toMap(key) {
        return this._items.reduce((acc, item) => {
            const indexValue = String(item[key]);
            acc[indexValue] = item;
            return acc;
        }, {});
    }
    toGrouped(field) {
        return this._items.reduce((groups, item) => {
            const groupKey = String(item[field]);
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(item);
            return groups;
        }, {});
    }
    toPages(page, pageSize) {
        if (page < 1)
            page = 1;
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        return this._items.slice(start, end);
    }
    first() {
        return this._items.length > 0 ? this._items[0] : null;
    }
    last() {
        return this._items.length > 0 ? this._items[this._items.length - 1] : null;
    }
    count() {
        return this._items.length;
    }
    keyBy(key) {
        const map = new Map();
        for (const item of this._items) {
            map.set(String(item[key]), item);
        }
        return map;
    }
    groupBy(key) {
        const map = new Map();
        for (const item of this._items) {
            const groupValue = String(item[key]);
            if (!map.has(groupValue)) {
                map.set(groupValue, []);
            }
            map.get(groupValue).push(item);
        }
        const collectionMap = new Map();
        for (const [k, v] of map) {
            collectionMap.set(k, new MikrotikCollection(v));
        }
        return collectionMap;
    }
    filter(predicate) {
        return new MikrotikCollection(this._items.filter(predicate));
    }
    sortBy(key, direction = 'asc') {
        this._items.sort((a, b) => {
            const valA = a[key];
            const valB = b[key];
            if (typeof valA === 'number' && typeof valB === 'number') {
                return direction === 'asc' ? valA - valB : valB - valA;
            }
            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();
            if (strA < strB)
                return direction === 'asc' ? -1 : 1;
            if (strA > strB)
                return direction === 'asc' ? 1 : -1;
            return 0;
        });
        return this;
    }
    sortByIp(key, direction = 'asc') {
        this._items.sort((a, b) => {
            const ipA = String(a[key]);
            const ipB = String(b[key]);
            const numA = this.ipToLong(ipA);
            const numB = this.ipToLong(ipB);
            return direction === 'asc' ? numA - numB : numB - numA;
        });
        return this;
    }
    ipToLong(ip) {
        if (!ip || ip.trim() === '')
            return 0;
        const cleanIp = ip.split('/')[0];
        return cleanIp.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }
}
exports.MikrotikCollection = MikrotikCollection;
//# sourceMappingURL=MikrotikCollection.js.map