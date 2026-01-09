"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MikrotikTransaction = void 0;
class MikrotikTransaction {
    constructor(client) {
        this.steps = [];
        this.useParallel = false;
        this.client = client;
    }
    add(path, params = {}) {
        this.steps.push({ path, params });
        return this;
    }
    parallel() {
        this.useParallel = true;
        return this;
    }
    async commit() {
        if (this.steps.length === 0)
            return [];
        if (this.useParallel) {
            return this.executeParallel();
        }
        else {
            return this.executeSequential();
        }
    }
    async executeSequential() {
        const results = [];
        for (const [index, step] of this.steps.entries()) {
            try {
                const result = await this.client.write(step.path, step.params);
                results.push(result);
            }
            catch (error) {
                throw new Error(`Transaction Failed at Step ${index + 1} (${step.path}): ${error.message || error}`);
            }
        }
        return results;
    }
    async executeParallel() {
        try {
            const promises = this.steps.map(step => this.client.write(step.path, step.params));
            return await Promise.all(promises);
        }
        catch (error) {
            throw new Error(`Parallel Transaction Failed: ${error.message || error}`);
        }
    }
}
exports.MikrotikTransaction = MikrotikTransaction;
//# sourceMappingURL=MikrotikTransaction.js.map