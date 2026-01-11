import { MikrotikClient } from '../client/MikrotikClient';

/**
 * Represents a file object from RouterOS /file/print
 */
export interface IFileEntry {
    '.id': string;
    name: string;
    type: string;
    size: string | number; // RouterOS returns strings like "4096"
    'creation-time': string;
    contents?: string; // Only present if file is small and text-based
}

/**
 * **FileManager**
 * * Advanced abstraction layer for file operations on RouterOS.
 * Features:
 * - Text File I/O (Read/Write scripts/logs).
 * - System Backup & Restore management.
 * - RSC Script Execution (Import).
 * - Directory listing and cleaning.
 */
export class FileManager {
    private client: MikrotikClient;

    constructor(client: MikrotikClient) {
        this.client = client;
    }

    // ==========================================
    // CORE FILE OPERATIONS
    // ==========================================

    /**
     * Lists files on the router, optionally filtering by name.
     * @param filterName Optional substring to filter files (e.g., ".backup")
     */
    public async list(filterName?: string): Promise<IFileEntry[]> {
        const cmd = this.client.command('/file');

        const result = await cmd.print();
        const files = result.toArray() as IFileEntry[];

        if (filterName) {
            return files.filter(f => f.name.includes(filterName));
        }

        return files;
    }

    /**
     * Checks if a file exists on the router.
     */
    public async exists(fileName: string): Promise<boolean> {
        const file = await this.client.command('/file')
            .where('name', fileName)
            .first();
        return !!file;
    }

    /**
     * Deletes a file or multiple files.
     * @param fileName Name of the file (or array of names).
     */
    public async delete(fileName: string | string[]): Promise<void> {
        const targets = Array.isArray(fileName) ? fileName : [fileName];

        // We need IDs to remove safely, or use 'remove [find where name=X]' logic
        // But the API supports removing by ID mostly.
        for (const name of targets) {
            const file = await this.client.command('/file').where('name', name).first();
            if (file) {
                await this.client.command('/file').remove(file['.id']);
                console.log(`[FileManager] Deleted: ${name}`);
            }
        }
    }

    // ==========================================
    // TEXT I/O (Scripts, Configs, Hotspot)
    // ==========================================

    /**
     * Writes text content to a file.
     * Handles creation if it doesn't exist.
     * * WARNING: RouterOS API has a limit for property values (~4MB in v7, less in v6).
     * Do not use this for binary files (.npk) or massive logs.
     */
    public async writeText(fileName: string, content: string): Promise<void> {
        if (content.length > 1024 * 1024) { // 1MB Guard
            console.warn(`[FileManager] Warning: Uploading ${content.length} bytes via API is risky.`);
        }

        const exists = await this.exists(fileName);

        if (!exists) {
            // Trick: 'print file=name' creates an empty file
            await this.client.write('/file/print', {
                file: fileName,
                where: 'false' // Suppress output
            }).catch(() => {}); // Ignore "interrupted" or empty return errors

            // Wait a tiny bit for FS sync
            await new Promise(r => setTimeout(r, 200));
        }

        // Update content
        await this.client.write('/file/set', {
            'numbers': fileName, // API allows name in numbers for some versions, but IDs are safer.
            'contents': content
        });

        console.log(`[FileManager] Saved: ${fileName}`);
    }

    /**
     * Reads text content from a file.
     * @returns string content, or throws error if file is binary/too large.
     */
    public async readText(fileName: string): Promise<string> {
        const file = await this.client.command('/file').where('name', fileName).first() as IFileEntry;

        if (!file) throw new Error(`File '${fileName}' not found.`);

        // RouterOS logic: If 'contents' is missing, the file is too big or binary.
        if (file.contents === undefined) {
            const size = Number(file.size);
            if (size > 4096) { // Heuristic: API often hides contents > 4KB (v6) or 64KB (v7)
                throw new Error(`File '${fileName}' is too large (${size} bytes) or binary to read via API. Use SFTP.`);
            }
            return ''; // Empty file
        }

        return file.contents;
    }

    // ==========================================
    // SYSTEM & AUTOMATION
    // ==========================================

    /**
     * Creates a System Backup (.backup) file.
     * @param name Backup name (without extension).
     * @param password Optional encryption password.
     */
    public async createSystemBackup(name: string, password?: string): Promise<string> {
        const fullName = `${name}.backup`;
        const params: any = { name: name };
        if (password) params.password = password;

        console.log(`[FileManager] Creating system backup: ${fullName}...`);

        await this.client.write('/system/backup/save', params);
        return fullName;
    }

    /**
     * Restores a System Backup.
     * DANGER: This will reboot the router.
     */
    public async restoreSystemBackup(name: string, password?: string): Promise<void> {
        console.warn(`[FileManager] RESTORING BACKUP ${name}. ROUTER WILL REBOOT.`);

        const params: any = { name: name };
        if (password) params.password = password;

        await this.client.write('/system/backup/load', params);
    }

    /**
     * Exports configuration to an RSC script file.
     * @param name File name (e.g., "daily_export")
     */
    public async createExport(name: string): Promise<string> {
        const fullName = name.endsWith('.rsc') ? name : `${name}.rsc`;
        console.log(`[FileManager] Exporting config to ${fullName}...`);

        // /export file=name
        await this.client.write('/export', { file: name });
        return fullName;
    }

    /**
     * Uploads a script (.rsc) and immediately executes it.
     * Great for provisioning or mass updates.
     */
    public async runScript(content: string, scriptName: string = 'temp_worker.rsc'): Promise<void> {
        try {
            // Upload
            await this.writeText(scriptName, content);

            // Execute (/import)
            console.log(`[FileManager] Executing script: ${scriptName}...`);
            await this.client.write('/import', { 'file-name': scriptName });

            console.log(`[FileManager] Script executed successfully.`);
        } catch (error) {
            console.error(`[FileManager] Script execution failed:`, error);
            throw error;
        } finally {
            // Cleanup (Optional: remove script after run)
            await this.delete(scriptName);
        }
    }
}