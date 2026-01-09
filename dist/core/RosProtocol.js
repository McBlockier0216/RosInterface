"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RosProtocol = void 0;
class RosProtocol {
    static encodeSentence(str) {
        const encoded = Buffer.from(str, 'utf8');
        const len = encoded.length;
        let offset = 0;
        let header;
        if (len < 0x80) {
            header = Buffer.alloc(1);
            header[offset++] = len;
        }
        else if (len < 0x4000) {
            header = Buffer.alloc(2);
            const lenBytes = len | 0x8000;
            header[offset++] = (lenBytes >> 8) & 0xff;
            header[offset++] = lenBytes & 0xff;
        }
        else if (len < 0x200000) {
            header = Buffer.alloc(3);
            const lenBytes = len | 0xc00000;
            header[offset++] = (lenBytes >> 16) & 0xff;
            header[offset++] = (lenBytes >> 8) & 0xff;
            header[offset++] = lenBytes & 0xff;
        }
        else if (len < 0x10000000) {
            header = Buffer.alloc(4);
            const lenBytes = len | 0xe0000000;
            header[offset++] = (lenBytes >> 24) & 0xff;
            header[offset++] = (lenBytes >> 16) & 0xff;
            header[offset++] = (lenBytes >> 8) & 0xff;
            header[offset++] = lenBytes & 0xff;
        }
        else {
            header = Buffer.alloc(5);
            header[offset++] = 0xf0;
            header[offset++] = (len >> 24) & 0xff;
            header[offset++] = (len >> 16) & 0xff;
            header[offset++] = (len >> 8) & 0xff;
            header[offset++] = len & 0xff;
        }
        return Buffer.concat([header, encoded]);
    }
    static decodeLength(buffer) {
        if (buffer.length === 0)
            return null;
        const b = buffer[0];
        if ((b & 0x80) === 0x00) {
            return { length: b, byteLength: 1 };
        }
        if ((b & 0xC0) === 0x80) {
            if (buffer.length < 2)
                return null;
            const len = ((b & 0x3F) << 8) | buffer[1];
            return { length: len, byteLength: 2 };
        }
        if ((b & 0xE0) === 0xC0) {
            if (buffer.length < 3)
                return null;
            const len = ((b & 0x1F) << 16) | (buffer[1] << 8) | buffer[2];
            return { length: len, byteLength: 3 };
        }
        if ((b & 0xF0) === 0xE0) {
            if (buffer.length < 4)
                return null;
            const len = ((b & 0x0F) << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
            return { length: len, byteLength: 4 };
        }
        if (b === 0xF0) {
            if (buffer.length < 5)
                return null;
            const len = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];
            return { length: len, byteLength: 5 };
        }
        return null;
    }
}
exports.RosProtocol = RosProtocol;
//# sourceMappingURL=RosProtocol.js.map