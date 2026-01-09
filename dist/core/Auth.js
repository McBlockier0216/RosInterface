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
exports.Auth = void 0;
const crypto = __importStar(require("crypto"));
const buffer_1 = require("buffer");
class Auth {
    static calculateLegacyMD5(password, challengeHex) {
        if (!challengeHex || typeof challengeHex !== 'string') {
            throw new Error('[Auth] Security Error: Invalid challenge format received from router.');
        }
        if (!/^[0-9a-fA-F]+$/.test(challengeHex)) {
            throw new Error('[Auth] Security Error: Non-hex characters detected in challenge.');
        }
        let bufferToHash = null;
        try {
            const challengeBytes = buffer_1.Buffer.from(challengeHex, 'hex');
            const passwordBytes = buffer_1.Buffer.from(password, 'utf8');
            const totalLength = 1 + passwordBytes.length + challengeBytes.length;
            bufferToHash = buffer_1.Buffer.alloc(totalLength);
            bufferToHash[0] = 0;
            passwordBytes.copy(bufferToHash, 1);
            challengeBytes.copy(bufferToHash, 1 + passwordBytes.length);
            const hash = crypto.createHash('md5').update(bufferToHash).digest('hex');
            return '00' + hash;
        }
        catch (error) {
            throw new Error(`[Auth] Cryptographic Failure: ${error.message}`);
        }
        finally {
            if (bufferToHash) {
                bufferToHash.fill(0);
            }
        }
    }
    static mask(value) {
        if (!value)
            return '<empty>';
        if (value.length < 4)
            return '***';
        const visibleStart = value.substring(0, 1);
        const visibleEnd = value.substring(value.length - 1);
        const maskLength = Math.min(value.length - 2, 8);
        return `${visibleStart}${'*'.repeat(maskLength)}${visibleEnd}`;
    }
    static isSafeForLogging(key) {
        const lowerKey = key.toLowerCase();
        return !lowerKey.includes('pass') &&
            !lowerKey.includes('secret') &&
            !lowerKey.includes('key') &&
            !lowerKey.includes('token');
    }
}
exports.Auth = Auth;
//# sourceMappingURL=Auth.js.map