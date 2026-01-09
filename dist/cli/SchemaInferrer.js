"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaInferrer = void 0;
class SchemaInferrer {
    static generateInterface(interfaceName, dataSample) {
        const fieldStats = {};
        dataSample.forEach(item => {
            Object.keys(item).forEach(key => {
                if (!fieldStats[key])
                    fieldStats[key] = new Set();
                fieldStats[key].add(String(item[key]));
            });
        });
        const lines = [];
        lines.push(`export interface ${interfaceName} {`);
        Object.keys(fieldStats).sort().forEach(key => {
            const values = Array.from(fieldStats[key]);
            const type = this.inferType(key, values);
            const isOptional = true;
            const propName = key.includes('-') ? `'${key}'` : key;
            lines.push(`    /** Sample values: ${values.slice(0, 3).join(', ')}... */`);
            lines.push(`    ${propName}${isOptional ? '?' : ''}: ${type};`);
        });
        lines.push(`}`);
        return lines.join('\n');
    }
    static inferType(key, values) {
        const isBoolean = values.every(v => ['true', 'false', 'yes', 'no'].includes(v.toLowerCase()));
        if (isBoolean)
            return 'boolean | string';
        const isNumber = values.every(v => v === '' || !isNaN(Number(v)));
        if (isNumber && values.length > 0)
            return 'number | string';
        if (values.length > 0 && values.length < 10 && !isNumber) {
            const union = values.map(v => `'${v}'`).join(' | ');
            return `${union} | string`;
        }
        return 'string';
    }
}
exports.SchemaInferrer = SchemaInferrer;
//# sourceMappingURL=SchemaInferrer.js.map