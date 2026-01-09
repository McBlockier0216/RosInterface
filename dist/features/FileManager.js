"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileManager = void 0;
class FileManager {
    constructor(client) {
        this.client = client;
    }
    async upload(fileName, content) {
        if (content.length > 1024 * 1024) {
            console.warn('[FileManager] Warning: Uploading large files via API is risky. Content > 1MB.');
        }
        const exists = await this.client.command('/file')
            .where('name', fileName)
            .first();
        if (!exists) {
            await this.client.write('/file/print', {
                file: fileName,
                where: 'false'
            }).catch(() => { });
        }
        await this.client.write('/file/set', {
            'numbers': fileName,
            'contents': content
        });
        console.log(`[FileManager] Successfully uploaded: ${fileName} (${content.length} bytes)`);
    }
    async download(fileName) {
        const file = await this.client.command('/file')
            .where('name', fileName)
            .first();
        if (!file)
            return null;
        return file.contents || '(Binary or Empty)';
    }
    async delete(fileName) {
        await this.client.command('/file').remove(fileName);
        console.log(`[FileManager] Deleted: ${fileName}`);
    }
}
exports.FileManager = FileManager;
//# sourceMappingURL=FileManager.js.map