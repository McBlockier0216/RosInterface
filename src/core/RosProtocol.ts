/**
 * RosProtocol.ts
 * * This module is the "mathematical heart" of the library.
 * It strictly handles the encoding and decoding of packet lengths
 * according to MikroTik's proprietary standard.
 * * Refactored and adapted from:
 * - node-routeros/src/connector/Transmitter.ts
 * - node-routeros/src/connector/Receiver.ts
 */

export class RosProtocol {

    /**
     * Converts a string (command) into a Buffer ready to be sent over the socket.
     * Includes the variable Length Encoding calculation.
     * * @param str The command or parameter (e.g., "/ip/address/print" or "=disabled=yes")
     */
    public static encodeSentence(str: string): Buffer {
        // Convert String to Bytes (Native UTF-8)
        // Note: The legacy library used 'win1252' via iconv-lite.
        // In 2025/26 and RouterOS v7, UTF-8 is preferable and requires no external dependencies.
        const encoded = Buffer.from(str, 'utf8');

        const len = encoded.length;
        let offset = 0;
        let header: Buffer;

        // Calculate how many bytes are needed to specify the length.
        // This logic is adopted directly from Transmitter.ts logic.
        if (len < 0x80) {
            // 1 byte for length
            header = Buffer.alloc(1);
            header[offset++] = len;
        } else if (len < 0x4000) {
            // 2 bytes
            header = Buffer.alloc(2);
            const lenBytes = len | 0x8000;
            header[offset++] = (lenBytes >> 8) & 0xff;
            header[offset++] = lenBytes & 0xff;
        } else if (len < 0x200000) {
            // 3 bytes
            header = Buffer.alloc(3);
            const lenBytes = len | 0xc00000;
            header[offset++] = (lenBytes >> 16) & 0xff;
            header[offset++] = (lenBytes >> 8) & 0xff;
            header[offset++] = lenBytes & 0xff;
        } else if (len < 0x10000000) {
            // 4 bytes
            header = Buffer.alloc(4);
            const lenBytes = len | 0xe0000000;
            header[offset++] = (lenBytes >> 24) & 0xff;
            header[offset++] = (lenBytes >> 16) & 0xff;
            header[offset++] = (lenBytes >> 8) & 0xff;
            header[offset++] = lenBytes & 0xff;
        } else {
            // 5 bytes (Extreme cases for giant payloads)
            header = Buffer.alloc(5);
            header[offset++] = 0xf0;
            header[offset++] = (len >> 24) & 0xff;
            header[offset++] = (len >> 16) & 0xff;
            header[offset++] = (len >> 8) & 0xff;
            header[offset++] = len & 0xff;
        }

        // 3. Concatenate the header (length) with the body (command)
        return Buffer.concat([header, encoded]);
    }

    /**
     * Attempts to read the length of the next packet in the buffer.
     * Refactored from Receiver.ts
     * * @param buffer The raw data buffer received from the socket
     * @returns An object containing the message length and the header byte size,
     * or NULL if there is not enough data yet.
     */
    public static decodeLength(buffer: Buffer): { length: number; byteLength: number } | null {
        if (buffer.length === 0) return null;

        const b = buffer[0];

        // Inverse bitwise logic to detect which length scheme was used

        // Case 1 byte (0xxxxxxx)
        if ((b & 0x80) === 0x00) {
            return { length: b, byteLength: 1 };
        }

        // Case 2 bytes (10xxxxxx ...)
        if ((b & 0xC0) === 0x80) {
            if (buffer.length < 2) return null; // Missing data
            const len = ((b & 0x3F) << 8) | buffer[1];
            return { length: len, byteLength: 2 };
        }

        // Case 3 bytes (110xxxxx ...)
        if ((b & 0xE0) === 0xC0) {
            if (buffer.length < 3) return null;
            const len = ((b & 0x1F) << 16) | (buffer[1] << 8) | buffer[2];
            return { length: len, byteLength: 3 };
        }

        // Case 4 bytes (1110xxxx ...)
        if ((b & 0xF0) === 0xE0) {
            if (buffer.length < 4) return null;
            const len = ((b & 0x0F) << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
            return { length: len, byteLength: 4 };
        }

        // Case 5 bytes (11110000 ...)
        if (b === 0xF0) {
            if (buffer.length < 5) return null;
            const len = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];
            return { length: len, byteLength: 5 };
        }

        // If we reach here, the initial byte is invalid according to the protocol
        return null;
    }
}