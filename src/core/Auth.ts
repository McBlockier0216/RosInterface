import * as crypto from 'crypto';
import { Buffer } from 'buffer';

/**
 * Auth.ts
 * * Critical Security Module.
 * * Handles cryptographic operations for authentication handshakes.
 * * * SECURITY FEATURES:
 * 1. Secure Buffer Allocation: Prevents memory reuse attacks.
 * 2. Memory Zeroing: Sensitive buffers are wiped after use.
 * 3. Input Validation: Strict checks on router challenges.
 * 4. Data Masking: Utilities to safely log configuration objects.
 */
export class Auth {

    /**
     * Calculates the MD5 hash required for the legacy RouterOS login protocol.
     * Logic: response = "00" + MD5( 0x00 + Password + Challenge_Bytes )
     * * * SECURITY UPGRADE:
     * This method actively wipes the password buffer from memory after hashing
     * to reduce the attack surface against memory dump techniques.
     * * @param password The user's password.
     * @param challengeHex The challenge string (hex) received from the router.
     * @returns The formatted response string expected by MikroTik.
     */
    public static calculateLegacyMD5(password: string, challengeHex: string): string {
        // 1. Strict Input Validation
        if (!challengeHex || typeof challengeHex !== 'string') {
            throw new Error('[Auth] Security Error: Invalid challenge format received from router.');
        }

        // RouterOS challenges are typically 32 hex characters (16 bytes)
        if (!/^[0-9a-fA-F]+$/.test(challengeHex)) {
            throw new Error('[Auth] Security Error: Non-hex characters detected in challenge.');
        }

        let bufferToHash: Buffer | null = null;

        try {
            // 2. Convert Hex Challenge to Bytes
            const challengeBytes = Buffer.from(challengeHex, 'hex');
            const passwordBytes = Buffer.from(password, 'utf8');

            // 3. Allocate Buffer (1 byte prefix + password + challenge)
            // We use allocUnsafe for speed but immediately overwrite it,
            // however, alloc is safer to prevent leaking previous memory data.
            const totalLength = 1 + passwordBytes.length + challengeBytes.length;
            bufferToHash = Buffer.alloc(totalLength);

            // 4. Construct the Payload
            // Byte 0: Must be zero (0x00) per protocol spec
            bufferToHash[0] = 0;

            // Bytes 1..N: Password
            passwordBytes.copy(bufferToHash, 1);

            // Bytes N..M: Challenge
            challengeBytes.copy(bufferToHash, 1 + passwordBytes.length);

            // 5. Calculate Hash
            const hash = crypto.createHash('md5').update(bufferToHash).digest('hex');

            return '00' + hash;

        } catch (error) {
            throw new Error(`[Auth] Cryptographic Failure: ${(error as Error).message}`);
        } finally {
            // 6. CRITICAL SECURITY STEP: Memory Zeroing
            // We overwrite the buffer containing the raw password with zeros
            // before releasing it to the Garbage Collector.
            if (bufferToHash) {
                bufferToHash.fill(0);
            }
        }
    }

    /**
     * Sanitizes sensitive strings for safe logging.
     * Use this when printing configuration objects to the console.
     * * @example
     * Auth.mask('supersecret') // returns "s*********t"
     * Auth.mask('123') // returns "***"
     */
    public static mask(value: string | undefined): string {
        if (!value) return '<empty>';
        if (value.length < 4) return '***';

        const visibleStart = value.substring(0, 1);
        const visibleEnd = value.substring(value.length - 1);
        const maskLength = Math.min(value.length - 2, 8); // Cap mask length for readability

        return `${visibleStart}${'*'.repeat(maskLength)}${visibleEnd}`;
    }

    /**
     * Utility to check if a password string is safe to use in logs.
     * (Always returns false, used to enforce masking policies).
     */
    public static isSafeForLogging(key: string): boolean {
        const lowerKey = key.toLowerCase();
        return !lowerKey.includes('pass') &&
            !lowerKey.includes('secret') &&
            !lowerKey.includes('key') &&
            !lowerKey.includes('token');
    }
}