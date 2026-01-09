"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultParser = void 0;
const Helpers_1 = require("../utils/Helpers");
class ResultParser {
    static parse(rawData) {
        return rawData.map(item => ResultParser.parseItem(item));
    }
    static parseItem(item) {
        const cleanItem = {};
        for (const key of Object.keys(item)) {
            const value = item[key];
            let newKey = key.startsWith('.') ? key.substring(1) : key;
            newKey = (0, Helpers_1.kebabToCamel)(newKey);
            cleanItem[newKey] = ResultParser.inferType(value);
        }
        return cleanItem;
    }
    static inferType(value) {
        const boolVal = (0, Helpers_1.parseBoolean)(value);
        if (boolVal !== null)
            return boolVal;
        if ((0, Helpers_1.isNumeric)(value) && (value.match(/\./g) || []).length <= 1) {
            return parseFloat(value);
        }
        return value;
    }
}
exports.ResultParser = ResultParser;
//# sourceMappingURL=ResultParser.js.map