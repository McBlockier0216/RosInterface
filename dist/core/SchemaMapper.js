"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaMapper = void 0;
class SchemaMapper {
    constructor() {
        this.version = '';
        this.majorVersion = 0;
        this.boardName = '';
        this.architecture = '';
        this.hasWireless = false;
        this.pathAliases = {};
    }
    async load(client) {
        try {
            const resourceCollection = await client.command('/system/resource').print();
            const resource = resourceCollection.first();
            if (resource) {
                this.version = resource.version || '0.0.0';
                this.majorVersion = parseInt(this.version.split('.')[0]);
                this.boardName = resource['board-name'] || 'unknown';
                this.architecture = resource['architecture-name'] || 'unknown';
            }
            try {
                const packages = await client.command('/system/package').print();
                this.hasWireless = packages.filter(p => p.name === 'wireless' || p.name === 'wifiwave2' || p.name === 'wifi').count() > 0;
            }
            catch (e) {
                console.warn('[SchemaMapper] Warning: Could not scan packages (Permission denied?). Defaulting features to false.');
            }
            this.buildPathMap();
            console.log(`Schema Loaded: RouterOS v${this.version} (${this.architecture}) on ${this.boardName}`);
        }
        catch (error) {
            console.error('Schema Discovery Failed:', error);
            this.majorVersion = 6;
            this.buildPathMap();
        }
    }
    buildPathMap() {
        if (this.majorVersion >= 7) {
            this.pathAliases['wifi'] = '/interface/wifi';
            this.pathAliases['bgp'] = '/routing/bgp/connection';
            this.pathAliases['ospf'] = '/routing/ospf/instance';
            this.pathAliases['firewall'] = '/ip/firewall/filter';
        }
        else {
            this.pathAliases['wifi'] = '/interface/wireless';
            this.pathAliases['bgp'] = '/routing/bgp/peer';
            this.pathAliases['ospf'] = '/routing/ospf/instance';
            this.pathAliases['firewall'] = '/ip/firewall/filter';
        }
    }
    resolve(path) {
        const cleanPath = path.startsWith('/') ? path.substring(1) : path;
        return this.pathAliases[cleanPath] || path;
    }
    isV7() {
        return this.majorVersion >= 7;
    }
    isArm() {
        return this.architecture === 'arm' || this.architecture === 'arm64';
    }
}
exports.SchemaMapper = SchemaMapper;
//# sourceMappingURL=SchemaMapper.js.map