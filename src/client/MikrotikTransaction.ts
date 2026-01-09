import { MikrotikClient } from './MikrotikClient';

/**
 * Defines a single step in a transaction.
 */
interface TransactionStep {
    path: string;
    params: Record<string, any>;
}

/**
 * MikrotikTransaction
 * Allows queuing multiple write commands and executing them as a batch.
 * Supports "Stop-on-Error" consistency.
 */
export class MikrotikTransaction {
    private client: MikrotikClient;
    private steps: TransactionStep[] = [];
    private useParallel: boolean = false;

    constructor(client: MikrotikClient) {
        this.client = client;
    }

    /**
     * Adds a command to the transaction queue.
     * @param path Menu path (e.g., '/ppp/secret/add')
     * @param params Command parameters
     */
    public add(path: string, params: Record<string, any> = {}): this {
        this.steps.push({ path, params });
        return this;
    }

    /**
     * Optimizes execution by running commands in parallel using Promise.all.
     * WARNING: Only use this if commands do not depend on each other.
     * (e.g. creating 5 independent users is safe, but creating a profile and then a user is NOT).
     */
    public parallel(): this {
        this.useParallel = true;
        return this;
    }

    /**
     * Executes the transaction.
     * - Sequential Mode (Default): Stops immediately if one command fails.
     * - Parallel Mode: Tries to execute all, throws aggregated error if any fail.
     */
    public async commit(): Promise<any[]> {
        if (this.steps.length === 0) return [];

        if (this.useParallel) {
            return this.executeParallel();
        } else {
            return this.executeSequential();
        }
    }

    /**
     * Safe execution: Step 1 -> Step 2 -> Step 3.
     * If Step 2 fails, Step 3 is never executed.
     */
    private async executeSequential(): Promise<any[]> {
        const results: any[] = [];

        for (const [index, step] of this.steps.entries()) {
            try {
                const result = await this.client.write(step.path, step.params);
                results.push(result);
            } catch (error: any) {
                // Enhance error message to tell the developer exactly where it failed
                throw new Error(
                    `Transaction Failed at Step ${index + 1} (${step.path}): ${error.message || error}`
                );
            }
        }
        return results;
    }

    /**
     * Fast execution: All at once.
     */
    private async executeParallel(): Promise<any[]> {
        try {
            const promises = this.steps.map(step =>
                this.client.write(step.path, step.params)
            );
            return await Promise.all(promises);
        } catch (error: any) {
            throw new Error(`Parallel Transaction Failed: ${error.message || error}`);
        }
    }
}