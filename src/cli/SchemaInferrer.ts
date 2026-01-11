/**
 * Analyzes raw MikroTik data and infers TypeScript types.
 */
export class SchemaInferrer {

    /**
     * Main entry point: Generates the Interface string from raw data items.
     */
    public static generateInterface(interfaceName: string, dataSample: Record<string, any>[]): string {
        const fieldStats: Record<string, Set<string>> = {};

        // Collect all possible values for each field across the sample
        dataSample.forEach(item => {
            Object.keys(item).forEach(key => {
                if (!fieldStats[key]) fieldStats[key] = new Set();
                fieldStats[key].add(String(item[key]));
            });
        });

        // Build the Interface lines
        const lines: string[] = [];
        lines.push(`export interface ${interfaceName} {`);

        Object.keys(fieldStats).sort().forEach(key => {
            const values = Array.from(fieldStats[key]);
            const type = this.inferType(key, values);

            // MikroTik fields are mostly optional as they depend on configuration
            const isOptional = true;
            const propName = key.includes('-') ? `'${key}'` : key; // Quote kebab-case

            lines.push(`    /** Sample values: ${values.slice(0, 3).join(', ')}... */`);
            lines.push(`    ${propName}${isOptional ? '?' : ''}: ${type};`);
        });

        lines.push(`}`);
        return lines.join('\n');
    }

    /**
     * Heuristic Engine to determine the best TypeScript type.
     */
    private static inferType(key: string, values: string[]): string {
        // Boolean Detection (true/false/yes/no)
        const isBoolean = values.every(v => ['true', 'false', 'yes', 'no'].includes(v.toLowerCase()));
        if (isBoolean) return 'boolean | string'; // string fallback for safety

        // Number Detection
        // Checks if all values look like numbers (ignoring empty strings)
        const isNumber = values.every(v => v === '' || !isNaN(Number(v)));
        if (isNumber && values.length > 0) return 'number | string';

        // Enum / Union Type Detection
        // If we see very few unique values (e.g. 'running' | 'stopped'), create a Union.
        // Limit: Max 10 unique values to consider it an Enum.
        if (values.length > 0 && values.length < 10 && !isNumber) {
            const union = values.map(v => `'${v}'`).join(' | ');
            return `${union} | string`; // Append string to allow future values
        }

        // Default
        return 'string';
    }
}