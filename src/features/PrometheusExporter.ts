import { MikrotikCollection } from '../utils/MikrotikCollection';

export enum MetricType {
    GAUGE = 'gauge',     // Value that goes up and down (e.g., CPU, Temp, Signal)
    COUNTER = 'counter'  // Value that only increases (e.g., Tx Bytes)
}

export interface MetricDefinition {
    /** The MikroTik property key (e.g., 'tx-byte') */
    sourceField: string;
    /** The Prometheus metric name (e.g., 'router_interface_tx_bytes') */
    metricName: string;
    /** Help string for documentation */
    help: string;
    /** Type of metric */
    type: MetricType;
    /** Labels to attach (e.g., ['name', 'mac-address']) */
    labels?: string[];
}

/**
 * PrometheusExporter
 * * Transformation Engine.
 * * Converts MikrotikCollection objects into Prometheus Exposition Format (text-based).
 */
export class PrometheusExporter {

    /**
     * Transforms a collection of MikroTik items into a single Prometheus string payload.
     * * @param collection The data returned from .print()
     * @param collection
     * @param definitions Array of rules defining how to map fields to metrics.
     * @returns A string ready to be served via HTTP /metrics endpoint.
     */
    public static export(collection: MikrotikCollection<any>, definitions: MetricDefinition[]): string {
        let output = '';
        const items = collection.toArray();

        for (const def of definitions) {
            // 1. Add TYPE and HELP headers
            output += `# HELP ${def.metricName} ${def.help}\n`;
            output += `# TYPE ${def.metricName} ${def.type}\n`;

            // 2. Iterate over all items (rows) from the router
            for (const item of items) {
                const value = item[def.sourceField];

                // Skip undefined or non-numeric values (unless mapped)
                if (value === undefined || value === null) continue;

                // 3. Build Labels (e.g., {interface="ether1", mac="..."})
                let labelString = '';
                if (def.labels && def.labels.length > 0) {
                    const labelParts = def.labels.map(labelField => {
                        // Clean values for safety
                        const rawLabelVal = String(item[labelField] || 'unknown');
                        const cleanLabelVal = rawLabelVal.replace(/"/g, '\\"');
                        // Map internal field name to clean label name (e.g. mac-address -> mac)
                        const cleanLabelName = labelField.replace(/-/g, '_');
                        return `${cleanLabelName}="${cleanLabelVal}"`;
                    });
                    labelString = `{${labelParts.join(',')}}`;
                }

                // 4. Format Line
                // router_cpu_load{host="192.168.1.1"} 15
                output += `${def.metricName}${labelString} ${value}\n`;
            }
            output += '\n';
        }

        return output;
    }
}