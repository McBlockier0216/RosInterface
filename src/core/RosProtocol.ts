/**
 * RosProtocol.ts
 * * Este módulo es el "corazón matemático" de la librería.
 * Se encarga estrictamente de codificar y decodificar la longitud de los paquetes
 * según el estándar propietario de MikroTik.
 * * Reciclado y refactorizado de:
 * - node-routeros/src/connector/Transmitter.ts
 * - node-routeros/src/connector/Receiver.ts
 */

export class RosProtocol {

    /**
     * Convierte un string (comando) en un Buffer listo para enviar por el socket.
     * Incluye el cálculo de longitud variable (Length Encoding).
     * * @param str El comando o parámetro (ej: "/ip/address/print" o "=disabled=yes")
     */
    public static encodeSentence(str: string): Buffer {
        // 1. Convertir String a Bytes (UTF-8 nativo)
        // Nota: La librería vieja usaba 'win1252' con iconv-lite.
        // En 2025/26 y RouterOS v7, UTF-8 es preferible y no requiere dependencias externas.
        const encoded = Buffer.from(str, 'utf8');

        const len = encoded.length;
        let offset = 0;
        let header: Buffer;

        // 2. Calcular cuántos bytes necesitamos para decir la longitud
        // Esta lógica es "robada" tal cual de Transmitter.ts
        if (len < 0x80) {
            // 1 byte para longitud
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
            // 5 bytes (Casos extremos de payloads gigantes)
            header = Buffer.alloc(5);
            header[offset++] = 0xf0;
            header[offset++] = (len >> 24) & 0xff;
            header[offset++] = (len >> 16) & 0xff;
            header[offset++] = (len >> 8) & 0xff;
            header[offset++] = len & 0xff;
        }

        // 3. Unir la cabecera (longitud) con el cuerpo (comando)
        return Buffer.concat([header, encoded]);
    }

    /**
     * Intenta leer la longitud del siguiente paquete en el buffer.
     * Reciclado de Receiver.ts
     * * @param buffer El buffer de datos crudos recibidos del socket
     * @returns Un objeto con la longitud del mensaje y cuántos bytes ocupó la cabecera,
     * o NULL si no hay suficientes datos para saberlo aún.
     */
    public static decodeLength(buffer: Buffer): { length: number; byteLength: number } | null {
        if (buffer.length === 0) return null;

        const b = buffer[0];

        // Lógica inversa de bits para detectar qué esquema de longitud se usó

        // Caso 1 byte (0xxxxxxx)
        if ((b & 0x80) === 0x00) {
            return { length: b, byteLength: 1 };
        }

        // Caso 2 bytes (10xxxxxx ...)
        if ((b & 0xC0) === 0x80) {
            if (buffer.length < 2) return null; // Faltan datos
            const len = ((b & 0x3F) << 8) | buffer[1];
            return { length: len, byteLength: 2 };
        }

        // Caso 3 bytes (110xxxxx ...)
        if ((b & 0xE0) === 0xC0) {
            if (buffer.length < 3) return null;
            const len = ((b & 0x1F) << 16) | (buffer[1] << 8) | buffer[2];
            return { length: len, byteLength: 3 };
        }

        // Caso 4 bytes (1110xxxx ...)
        if ((b & 0xF0) === 0xE0) {
            if (buffer.length < 4) return null;
            const len = ((b & 0x0F) << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
            return { length: len, byteLength: 4 };
        }

        // Caso 5 bytes (11110000 ...)
        if (b === 0xF0) {
            if (buffer.length < 5) return null;
            // Nota: Javascript bitwise operators tratan los números como 32-bit signed integers.
            // Para números extremadamente grandes aquí podría haber un problema de overflow
            // si no usamos BigInt, pero para el uso normal de API (configuración) es seguro.
            const len = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];
            return { length: len, byteLength: 5 };
        }

        // Si llegamos aquí, el byte inicial es inválido según el protocolo
        return null;
    }
}