import { MikrotikClient } from '../client/MikrotikClient';
export declare class FileManager {
    private client;
    constructor(client: MikrotikClient);
    upload(fileName: string, content: string): Promise<void>;
    download(fileName: string): Promise<string | null>;
    delete(fileName: string): Promise<void>;
}
