"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrometheusExporter = exports.MetricType = void 0;
var MetricType;
(function (MetricType) {
    MetricType["GAUGE"] = "gauge";
    MetricType["COUNTER"] = "counter";
})(MetricType || (exports.MetricType = MetricType = {}));
class PrometheusExporter {
    static export(collection, definitions) {
        let output = '';
        const items = collection.toArray();
        for (const def of definitions) {
            output += `# HELP ${def.metricName} ${def.help}\n`;
            output += `# TYPE ${def.metricName} ${def.type}\n`;
            for (const item of items) {
                const value = item[def.sourceField];
                if (value === undefined || value === null)
                    continue;
                let labelString = '';
                if (def.labels && def.labels.length > 0) {
                    const labelParts = def.labels.map(labelField => {
                        const rawLabelVal = String(item[labelField] || 'unknown');
                        const cleanLabelVal = rawLabelVal.replace(/"/g, '\\"');
                        const cleanLabelName = labelField.replace(/-/g, '_');
                        return `${cleanLabelName}="${cleanLabelVal}"`;
                    });
                    labelString = `{${labelParts.join(',')}}`;
                }
                output += `${def.metricName}${labelString} ${value}\n`;
            }
            output += '\n';
        }
        return output;
    }
}
exports.PrometheusExporter = PrometheusExporter;
//# sourceMappingURL=PrometheusExporter.js.map