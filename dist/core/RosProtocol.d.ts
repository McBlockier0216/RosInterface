export declare class RosProtocol {
    static encodeSentence(str: string): Buffer;
    static decodeLength(buffer: Buffer): {
        length: number;
        byteLength: number;
    } | null;
}
