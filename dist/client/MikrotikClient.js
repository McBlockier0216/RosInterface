"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MikrotikClient = void 0;
const dotenv = __importStar(require("dotenv"));
const Auth_1 = require("../core/Auth");
const SocketClient_1 = require("../core/SocketClient");
const RosProtocol_1 = require("../core/RosProtocol");
const ResultParser_1 = require("./ResultParser");
const CommandBuilder_1 = require("./CommandBuilder");
const SchemaMapper_1 = require("../core/SchemaMapper");
const RateLimiter_1 = require("../core/RateLimiter");
const CircuitBreaker_1 = require("../core/CircuitBreaker");
const FileManager_1 = require("../features/FileManager");
const PrometheusExporter_1 = require("../features/PrometheusExporter");
const LiveCollection_1 = require("../features/LiveCollection");
const MikrotikTransaction_1 = require("./MikrotikTransaction");
dotenv.config();
class MikrotikClient {
    constructor(options) {
        this.isConfigFromEnv = false;
        this.activeLiveCollections = new Map();
        this.schema = new SchemaMapper_1.SchemaMapper();
        this.pendingCommands = new Map();
        this.currentSentence = {};
        const envHost = process.env.MIKROTIK_HOST;
        const envUser = process.env.MIKROTIK_USER;
        const envPass = process.env.MIKROTIK_PASS;
        const envPort = process.env.MIKROTIK_PORT;
        this.isConfigFromEnv = !!(envHost && envUser && envPass);
        this.options = {
            host: envHost || options.host,
            user: envUser || options.user,
            password: envPass || options.password,
            port: envPort ? Number(envPort) : options.port,
            useTLS: options.useTLS ?? false,
            rejectUnauthorized: options.rejectUnauthorized ?? false,
            allowInsecureConfig: options.allowInsecureConfig ?? false,
            timeout: options.timeout || 10,
            rateLimit: options.rateLimit || 50,
        };
        this.rateLimiter = new RateLimiter_1.RateLimiter(this.options.rateLimit);
        this.breaker = new CircuitBreaker_1.CircuitBreaker(options.circuitBreaker);
        this.files = new FileManager_1.FileManager(this);
        if (!this.isConfigFromEnv && this.options.allowInsecureConfig) {
            this.printSeriousWarning();
        }
        this.socket = new SocketClient_1.SocketClient(this.options);
        this.socket.on('data', (word) => this.processIncomingWord(word));
        this.socket.on('close', () => this.rejectAllCommands(new Error('Connection closed')));
        this.socket.on('error', (err) => this.rejectAllCommands(err));
    }
    async connect() {
        if (!this.isConfigFromEnv && !this.options.allowInsecureConfig) {
            throw new Error('FATAL: Insecure Configuration. Use .env or allowInsecureConfig: true');
        }
        await this.breaker.execute(async () => {
            await this.socket.connect();
            await this.login();
            await this.schema.load(this);
        });
    }
    printSeriousWarning() {
        const border = "=".repeat(60);
        console.warn(`\n\x1b[33m${border}\x1b[0m`);
        console.warn('\x1b[43m\x1b[30m %s \x1b[0m', ' SERIOUS SECURITY ADVISORY ');
        console.warn('\x1b[33m%s\x1b[0m', 'Using hardcoded credentials. Please use .env file.');
        console.warn(`\x1b[33m${border}\x1b[0m\n`);
    }
    close() {
        this.socket.close();
    }
    command(path) {
        const realPath = this.schema.resolve(path);
        return new CommandBuilder_1.CommandBuilder(this, realPath);
    }
    transaction() {
        return new MikrotikTransaction_1.MikrotikTransaction(this);
    }
    collection(path) {
        const query = {};
        const builder = {
            where: (key, value) => {
                query[key] = value;
                return builder;
            },
            print: async () => {
                const cmd = new CommandBuilder_1.CommandBuilder(this, path);
                Object.keys(query).forEach(k => cmd.where(k, query[k]));
                return cmd.print();
            },
            onSnapshot: (callback) => {
                const cacheKey = `${path}:${JSON.stringify(query)}`;
                let liveCol = this.activeLiveCollections.get(cacheKey);
                if (!liveCol) {
                    liveCol = new LiveCollection_1.LiveCollection(this, path, query);
                    this.activeLiveCollections.set(cacheKey, liveCol);
                }
                return liveCol.onSnapshot(callback);
            }
        };
        return builder;
    }
    async getMetrics(path, metrics, params) {
        const data = await this.command(path).print(params);
        return PrometheusExporter_1.PrometheusExporter.export(data, metrics);
    }
    async write(command, parameters) {
        return this.breaker.execute(async () => {
            await this.rateLimiter.acquire();
            return new Promise((resolve, reject) => {
                const tag = this.generateTag();
                const payload = this.buildPayload(command, parameters, tag);
                this.pendingCommands.set(tag, {
                    resolve,
                    reject,
                    data: [],
                    isStream: false,
                    startTime: Date.now(),
                    tag
                });
                this.sendPayload(payload);
            });
        });
    }
    stream(commandOrLines, parameters, callback) {
        const tag = this.generateTag();
        this.rateLimiter.acquire().then(() => {
            let payload;
            if (Array.isArray(commandOrLines)) {
                payload = [...commandOrLines];
                if (!payload.some(l => l.startsWith('.tag='))) {
                    payload.push(`.tag=${tag}`);
                }
            }
            else {
                payload = this.buildPayload(commandOrLines, parameters, tag);
            }
            this.pendingCommands.set(tag, {
                reject: (err) => console.error(`Stream error [${tag}]:`, err),
                data: [],
                isStream: true,
                onData: callback,
                startTime: Date.now(),
                tag
            });
            this.sendPayload(payload);
        });
        return {
            stop: async () => {
                await this.writeInternal('/cancel', { 'tag': tag });
            }
        };
    }
    generateTag() {
        return 't' + Math.random().toString(36).substring(2, 9);
    }
    buildPayload(command, params, tag) {
        const payload = [command];
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                const prefix = key.startsWith('?') ? '' : '=';
                payload.push(`${prefix}${key}=${value}`);
            }
        }
        payload.push(`.tag=${tag}`);
        return payload;
    }
    sendPayload(payload) {
        for (const word of payload) {
            this.socket.write(RosProtocol_1.RosProtocol.encodeSentence(word));
        }
        this.socket.write(RosProtocol_1.RosProtocol.encodeSentence(''));
    }
    async login() {
        return new Promise(async (resolve, reject) => {
            try {
                const response = await this.writeInternal('/login', {
                    name: this.options.user || '',
                    password: this.options.password || ''
                });
                const lastMsg = response[response.length - 1] || {};
                if (lastMsg['ret']) {
                    const challenge = lastMsg['ret'];
                    const md5Response = Auth_1.Auth.calculateLegacyMD5(this.options.password || '', challenge);
                    await this.writeInternal('/login', {
                        name: this.options.user || '',
                        response: md5Response
                    });
                }
                resolve();
            }
            catch (error) {
                reject(error);
            }
        });
    }
    writeInternal(command, parameters) {
        return new Promise((resolve, reject) => {
            const tag = this.generateTag();
            const payload = this.buildPayload(command, parameters, tag);
            this.pendingCommands.set(tag, {
                resolve,
                reject,
                data: [],
                isStream: false,
                startTime: Date.now(),
                tag
            });
            this.sendPayload(payload);
        });
    }
    processIncomingWord(word) {
        if (word.length === 0) {
            this.routeSentence(this.currentSentence);
            this.currentSentence = {};
            return;
        }
        if (word.startsWith('!'))
            this.currentSentence['!type'] = word;
        else if (word.startsWith('.tag='))
            this.currentSentence['.tag'] = word.substring(5);
        else if (word.startsWith('=')) {
            const parts = word.substring(1).split('=');
            this.currentSentence[parts[0]] = parts.slice(1).join('=');
        }
        else if (word.startsWith('ret=')) {
            this.currentSentence['ret'] = word.substring(4);
        }
        else {
            this.currentSentence[word] = true;
        }
    }
    routeSentence(sentence) {
        const tag = sentence['.tag'];
        const type = sentence['!type'];
        if (!tag || !this.pendingCommands.has(tag))
            return;
        const cmd = this.pendingCommands.get(tag);
        if (type === '!re') {
            const cleanObj = { ...sentence };
            delete cleanObj['!type'];
            delete cleanObj['.tag'];
            if (cmd.isStream && cmd.onData) {
                const parsed = ResultParser_1.ResultParser.parse([cleanObj])[0];
                cmd.onData(parsed);
            }
            else {
                cmd.data.push(cleanObj);
            }
        }
        else if (type === '!done') {
            const duration = Date.now() - cmd.startTime;
            this.rateLimiter.submitFeedback(duration);
            if (!cmd.isStream && cmd.resolve) {
                if (cmd.data.length === 0 && Object.keys(sentence).length > 2) {
                    const cleanObj = { ...sentence };
                    delete cleanObj['!type'];
                    delete cleanObj['.tag'];
                    cmd.data.push(cleanObj);
                }
                cmd.resolve(ResultParser_1.ResultParser.parse(cmd.data));
            }
            this.pendingCommands.delete(tag);
        }
        else if (type === '!trap') {
            const duration = Date.now() - cmd.startTime;
            this.rateLimiter.submitFeedback(duration);
            const errorMsg = sentence['message'] || 'Unknown MikroTik Error';
            if (errorMsg.includes('interrupted')) {
                this.pendingCommands.delete(tag);
                return;
            }
            cmd.reject(new Error(errorMsg));
            this.pendingCommands.delete(tag);
        }
    }
    rejectAllCommands(error) {
        for (const [tag, cmd] of this.pendingCommands) {
            cmd.reject(error);
        }
        this.pendingCommands.clear();
    }
}
exports.MikrotikClient = MikrotikClient;
//# sourceMappingURL=MikrotikClient.js.map