import {RosError} from './RosError';
import { Agent, Dispatcher } from 'undici';

export interface IRestOptions {
    host: string;
    user: string;
    pass: string;
    port?: number;
    timeout?: number;
    insecure?: boolean;
}

export interface ICommandOptions {
    idempotent?: boolean;
    idempotencyKey?: string;
}

export class RestProtocol {
    private readonly baseUrl: string;
    private readonly authHeader: string;
    private readonly dispatcher: Dispatcher;
    private readonly timeout: number;

    constructor(options: IRestOptions) {
        const port = options.port || 443;
        this.baseUrl = `https://${options.host}:${port}/rest`;
        this.timeout = options.timeout || 10000;
        this.authHeader = 'Basic ' + Buffer.from(`${options.user}:${options.pass}`).toString('base64');

        this.dispatcher = new Agent({
            connect: {
                rejectUnauthorized: !options.insecure
            }
        });
    }

    public async connect(): Promise<boolean> {
        try {
            await this.command('/system/resource/print');
            return true;
        } catch (error: any) {
            if (error.isRosError) throw error;
            const reason = error.cause ? error.cause.message : error.message;
            const code = error.cause ? (error.cause as any).code : 'UNKNOWN';
            throw new Error(`RestProtocol Connection Failed: ${reason} (Code: ${code}). URL: ${this.baseUrl}`);
        }
    }

    public close(): void {
        this.dispatcher.destroy();
    }

    public async command(cmd: string, params: Record<string, any> = {}, options?: ICommandOptions): Promise<any> {
        const {method, url, body} = this.translateToRest(cmd, params);

        const fetchOptions: any = {
            method: method,
            headers: {
                'Authorization': this.authHeader,
                'Content-Type': 'application/json'
            },
            dispatcher: this.dispatcher,
            signal: AbortSignal.timeout(this.timeout)
        };

        if (method !== 'GET' && method !== 'HEAD') {
            fetchOptions.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                const rosError = await RosError.fromResponse(response, cmd);

                // IDEMPOTENCY LOGIC
                if (options?.idempotent && rosError.isDuplicate) {
                    const keyField = options.idempotencyKey || 'name';
                    if (body && body[keyField]) {
                        return await this.recoverExistingItem(url, keyField, body[keyField]);
                    }
                }

                throw rosError;
            }

            // Handle 204 No Content (Success but no body, common in DELETE/PUT)
            if (response.status === 204) {
                return null;
            }

            return await response.json();

        } catch (error: any) {
            if (error instanceof RosError) throw error;
            if (error.cause?.code === 'ECONNREFUSED') {
                throw new Error(`RestProtocol: Connection refused at ${this.baseUrl}. Is the /rest service enabled?`);
            }
            throw error;
        }
    }

    private async recoverExistingItem(resourceBaseUrl: string, keyField: string, value: string): Promise<any> {
        const searchUrl = `${resourceBaseUrl}?${keyField}=${encodeURIComponent(value)}`;

        const fetchOptions: any = {
            method: 'GET',
            headers: {'Authorization': this.authHeader},
            dispatcher: this.dispatcher,
            signal: AbortSignal.timeout(this.timeout)
        };

        const response = await fetch(searchUrl, fetchOptions);

        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                const item = data[0];
                return {...item, _idempotent_recovery: true};
            }
        }
        throw new Error(`Idempotency Failed: Item with ${keyField}='${value}' exists but could not be retrieved.`);
    }

    /**
     * Translates CLI commands to REST API logic according to Mikrotik v7 Docs.
     * Mappings:
     * - /print  -> GET
     * - /add    -> PUT  (Fixed: Docs say PUT is for Create)
     * - /set    -> PATCH
     * - /remove -> DELETE
     * - others  -> POST (Universal)
     */
    private translateToRest(cmd: string, params: Record<string, any>) {
        let cleanPath = cmd.replace(/\/+$/, '');
        let method = 'POST'; // Default safe verb
        let body: Record<string, any> | undefined = { ...params };

        // CASE: PRINT (Read)
        if (cleanPath.endsWith('/print')) {
            if (Object.keys(params).length > 0) {
                method = 'POST';
                const queryStack: string[] = [];
                const newBody: any = {};

                for (const [key, value] of Object.entries(params)) {
                    if (key === '.proplist') {
                        newBody['.proplist'] = Array.isArray(value) ? value : String(value).split(',');
                    } else {
                        queryStack.push(`${key}=${value}`);
                    }
                }

                if (queryStack.length > 0) {
                    newBody['.query'] = queryStack;
                }

                body = newBody;

            } else {
                method = 'GET';
                cleanPath = cleanPath.replace(/\/print$/, '');
                body = undefined;
            }
        }

        // CASE: ADD (Create) -> PUT
        else if (cleanPath.endsWith('/add')) {
            method = 'PUT';
            cleanPath = cleanPath.replace(/\/add$/, '');
        }

        // CASE: SET (Update) -> PATCH
        else if (cleanPath.endsWith('/set')) {
            method = 'PATCH';
            cleanPath = cleanPath.replace(/\/set$/, '');
            if (body && body['.id']) {
                cleanPath += `/${body['.id']}`;
                delete body['.id'];
            } else {
                throw new Error("RestProtocol: To use 'set' (PATCH), you must provide the '.id' parameter.");
            }
        }

        // CASE: REMOVE (Delete) -> DELETE
        else if (cleanPath.endsWith('/remove')) {
            method = 'DELETE';
            cleanPath = cleanPath.replace(/\/remove$/, '');
            if (body && body['.id']) {
                cleanPath += `/${body['.id']}`;
                delete body['.id'];
            } else {
                throw new Error("RestProtocol: To use 'remove' (DELETE), you must provide the '.id' parameter.");
            }
        }

        const url = `${this.baseUrl}${cleanPath}`;
        
        return { method, url, body };
    }



}