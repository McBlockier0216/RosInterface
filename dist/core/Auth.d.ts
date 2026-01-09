export declare class Auth {
    static calculateLegacyMD5(password: string, challengeHex: string): string;
    static mask(value: string | undefined): string;
    static isSafeForLogging(key: string): boolean;
}
