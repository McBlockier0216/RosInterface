"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MikrotikPool = void 0;
const MikrotikClient_1 = require("./MikrotikClient");
const CommandBuilder_1 = require("./CommandBuilder");
class MikrotikPool {
    constructor(options) {
        this.clients = [];
        this.nextClientIndex = 0;
        this.isConnected = false;
        this.options = {
            poolSize: 5,
            ...options
        };
    }
    async connect() {
        if (this.isConnected)
            return;
        console.log(`🚀 Initializing Pool with ${this.options.poolSize} connections...`);
        const connectionPromises = [];
        for (let i = 0; i < (this.options.poolSize || 5); i++) {
            const client = new MikrotikClient_1.MikrotikClient(this.options);
            this.clients.push(client);
            connectionPromises.push(client.connect());
        }
        await Promise.all(connectionPromises);
        this.isConnected = true;
        console.log(`✅ Pool Ready: ${this.clients.length} sockets connected.`);
    }
    close() {
        this.clients.forEach(client => client.close());
        this.isConnected = false;
        this.clients = [];
    }
    getScheduledClient() {
        if (this.clients.length === 0) {
            throw new Error('Pool is not connected. Call connect() first.');
        }
        const client = this.clients[this.nextClientIndex];
        this.nextClientIndex = (this.nextClientIndex + 1) % this.clients.length;
        return client;
    }
    command(path) {
        const selectedClient = this.getScheduledClient();
        return new CommandBuilder_1.CommandBuilder(selectedClient, path);
    }
    write(command, parameters) {
        return this.getScheduledClient().write(command, parameters);
    }
    stream(command, parameters, callback) {
        return this.getScheduledClient().stream(command, parameters, callback);
    }
}
exports.MikrotikPool = MikrotikPool;
//# sourceMappingURL=MikrotikPool.js.map