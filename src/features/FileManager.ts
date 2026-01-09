import { MikrotikClient } from '../client/MikrotikClient';

/**
 * FileManager
 * * Abstraction layer for handling files on RouterOS.
 * * Allows creating, reading, and updating files (scripts, configs) via API.
 */
export class FileManager {
    private client: MikrotikClient;

    constructor(client: MikrotikClient) {
        this.client = client;
    }

    /**
     * Uploads text content to a file on the router.
     * Useful for provisioning scripts (.rsc) or configuration files.
     * * @param fileName The name of the file (e.g., "script.rsc")
     * @param content The string content to write.
     */
    public async upload(fileName: string, content: string): Promise<void> {
        // RouterOS API Limitation:
        // Sending huge strings in one packet can cause disconnects.
        // A safe limit is usually around 4MB-6MB depending on RAM, but safer is <1MB.
        if (content.length > 1024 * 1024) {
            console.warn('[FileManager] Warning: Uploading large files via API is risky. Content > 1MB.');
        }

        // 1. Check if file exists to decide between 'add' or 'set'
        const exists = await this.client.command('/file')
            .where('name', fileName)
            .first();

        if (!exists) {
            // Create new file
            await this.client.write('/file/print', {
                file: fileName, // This trick creates a dummy file print output
                where: 'false'  // No output needed, just file creation
            }).catch(() => {}); // Ignore errors, file might be created anyway
            
        }

        // 2. Write content using /file/set
        // Note: We need the ID or name. Using Name is safer in scripts.
        await this.client.write('/file/set', {
            'numbers': fileName,
            'contents': content
        });

        console.log(`[FileManager] Successfully uploaded: ${fileName} (${content.length} bytes)`);
    }

    /**
     * Reads the content of a specific file.
     * @param fileName Name of the file.
     * @returns The content string or null if not found.
     */
    public async download(fileName: string): Promise<string | null> {
        const file = await this.client.command('/file')
            .where('name', fileName)
            .first();

        if (!file) return null;

        // RouterOS returns content in the 'contents' property,
        // but only if it's a text file and small enough.
        return file.contents || '(Binary or Empty)';
    }

    /**
     * Deletes a file from the router.
     */
    public async delete(fileName: string): Promise<void> {
        await this.client.command('/file').remove(fileName);
        console.log(`[FileManager] Deleted: ${fileName}`);
    }
}