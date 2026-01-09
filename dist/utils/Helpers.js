"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kebabToCamel = kebabToCamel;
exports.camelToKebab = camelToKebab;
exports.isNumeric = isNumeric;
exports.parseBoolean = parseBoolean;
function kebabToCamel(str) {
    return str.replace(/-./g, (x) => x[1].toUpperCase());
}
function camelToKebab(str) {
    return str.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`);
}
function isNumeric(str) {
    if (typeof str !== "string")
        return false;
    return !isNaN(parseFloat(str)) && isFinite(Number(str));
}
function parseBoolean(value) {
    if (value === 'true' || value === 'yes')
        return true;
    if (value === 'false' || value === 'no')
        return false;
    return null;
}
//# sourceMappingURL=Helpers.js.map