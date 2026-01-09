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
exports.SocketClient = void 0;
const net = __importStar(require("net"));
const tls = __importStar(require("tls"));
const events_1 = require("events");
const buffer_1 = require("buffer");
const RosProtocol_1 = require("./RosProtocol");
class SocketClient extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.socket = null;
        this.connected = false;
        this.receiveBuffer = buffer_1.Buffer.alloc(0);
        this.options = {
            timeout: 10,
            rejectUnauthorized: false,
            keepAlive: true,
            useTLS: false,
            ...options
        };
    }
    connect() {
        return new Promise((resolve, reject) => {
            if (this.connected)
                return resolve();
            this.cleanup();
            const timeoutMs = (this.options.timeout || 10) * 1000;
            try {
                if (this.options.useTLS) {
                    const tlsOptions = {
                        host: this.options.host,
                        port: this.options.port,
                        rejectUnauthorized: this.options.rejectUnauthorized,
                        timeout: timeoutMs
                    };
                    this.socket = tls.connect(tlsOptions);
                }
                else {
                    this.socket = new net.Socket();
                    this.socket.setTimeout(timeoutMs);
                    this.socket.connect(this.options.port, this.options.host);
                }
            }
            catch (err) {
                return reject(err);
            }
            this.socket.once('timeout', () => {
                const err = new Error(`Connection timed out after ${this.options.timeout} seconds`);
                this.destroy();
                reject(err);
            });
            this.socket.setNoDelay(true);
            if (this.options.keepAlive && this.socket instanceof net.Socket) {
                this.socket.setKeepAlive(true, 10000);
            }
            const connectEvent = this.options.useTLS ? 'secureConnect' : 'connect';
            this.socket.once(connectEvent, () => {
                this.connected = true;
                if (this.socket)
                    this.socket.setTimeout(0);
                this.emit('connect');
                resolve();
            });
            this.socket.on('error', (err) => {
                if (!this.connected) {
                    reject(err);
                }
                else {
                    this.emit('error', err);
                }
            });
            this.socket.on('close', (hadError) => {
                this.connected = false;
                this.emit('close', hadError);
            });
            this.socket.on('data', (chunk) => {
                const bufferChunk = buffer_1.Buffer.isBuffer(chunk)
                    ? chunk
                    : buffer_1.Buffer.from(chunk, 'utf8');
                this.handleDataChunk(bufferChunk);
            });
        });
    }
    write(data) {
        if (!this.connected || !this.socket) {
            throw new Error('Socket is not connected. Call connect() first.');
        }
        this.socket.write(data);
    }
    close() {
        if (this.socket && !this.socket.destroyed) {
            this.socket.end();
            this.connected = false;
        }
    }
    destroy() {
        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
            this.connected = false;
        }
    }
    cleanup() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.destroy();
            this.socket = null;
        }
        this.receiveBuffer = buffer_1.Buffer.alloc(0);
    }
    handleDataChunk(chunk) {
        this.receiveBuffer = buffer_1.Buffer.concat([this.receiveBuffer, chunk]);
        while (this.receiveBuffer.length > 0) {
            const lengthInfo = RosProtocol_1.RosProtocol.decodeLength(this.receiveBuffer);
            if (!lengthInfo) {
                break;
            }
            const { length, byteLength } = lengthInfo;
            const totalPacketSize = byteLength + length;
            if (this.receiveBuffer.length < totalPacketSize) {
                break;
            }
            const payload = this.receiveBuffer.slice(byteLength, totalPacketSize);
            this.receiveBuffer = this.receiveBuffer.slice(totalPacketSize);
            const word = payload.toString('utf8');
            this.emit('data', word);
        }
    }
}
exports.SocketClient = SocketClient;
//# sourceMappingURL=SocketClient.js.map