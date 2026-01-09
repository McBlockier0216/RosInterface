import { MikrotikCollection } from '../utils/MikrotikCollection';
export declare enum MetricType {
    GAUGE = "gauge",
    COUNTER = "counter"
}
export interface MetricDefinition {
    sourceField: string;
    metricName: string;
    help: string;
    type: MetricType;
    labels?: string[];
}
export declare class PrometheusExporter {
    static export(collection: MikrotikCollection<any>, definitions: MetricDefinition[]): string;
}
