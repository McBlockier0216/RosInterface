import { MikrotikClient } from '../client/MikrotikClient';
export declare class SchemaMapper {
    version: string;
    majorVersion: number;
    boardName: string;
    architecture: string;
    hasWireless: boolean;
    private pathAliases;
    load(client: MikrotikClient): Promise<void>;
    private buildPathMap;
    resolve(path: string): string;
    isV7(): boolean;
    isArm(): boolean;
}
