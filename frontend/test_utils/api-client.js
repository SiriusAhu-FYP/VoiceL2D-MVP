import http from 'node:http';

const DEFAULT_PORT = Number(
    process.env.FRONTEND_PORT
    || process.env.VITE_PORT
    || process.env.LIVE2D_PORT
    || 7788,
);

const FLAG_VARIANTS = {
    apiBase: ['--api-base'],
    port: ['--port', '-p'],
};

const getFlagIndex = (args, names) => args.findIndex(
    (arg) => names.some(
        (name) => arg === name || arg.startsWith(`${name}=`),
    ),
);

const extractFlagValue = (args, index, names) => {
    if (index === -1) {
        return { value: undefined, removed: 0 };
    }
    const arg = args[index];
    const name = names.find(
        (variant) => arg === variant || arg.startsWith(`${variant}=`),
    );
    if (!name) {
        return { value: undefined, removed: 0 };
    }
    if (arg.startsWith(`${name}=`)) {
        return {
            value: arg.slice(name.length + 1),
            removed: 1,
        };
    }
    const nextValue = args[index + 1];
    return {
        value: nextValue,
        removed: nextValue === undefined ? 1 : 2,
    };
};

export function resolveApiConfig(rawArgs = []) {
    const args = [...rawArgs];
    let customBase = process.env.LIVE2D_API_BASE || '';
    let resolvedPort = DEFAULT_PORT;

    const apiBaseIndex = getFlagIndex(args, FLAG_VARIANTS.apiBase);
    if (apiBaseIndex !== -1) {
        const { value, removed } = extractFlagValue(args, apiBaseIndex, FLAG_VARIANTS.apiBase);
        if (removed > 0) {
            args.splice(apiBaseIndex, removed);
        }
        if (value) {
            customBase = value;
        }
    }

    const portIndex = getFlagIndex(args, FLAG_VARIANTS.port);
    if (portIndex !== -1) {
        const { value, removed } = extractFlagValue(args, portIndex, FLAG_VARIANTS.port);
        if (removed > 0) {
            args.splice(portIndex, removed);
        }
        if (value) {
            const parsed = Number(value);
            if (!Number.isNaN(parsed)) {
                resolvedPort = parsed;
            }
        }
    }

    const apiBase = customBase || `http://localhost:${resolvedPort}`;

    return {
        args,
        apiBase,
        port: resolvedPort,
    };
}

export function requestJson(apiBase, path, options = {}) {
    const url = new URL(path, apiBase);
    const requestOptions = {
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
    };

    return new Promise((resolve, reject) => {
        const req = http.request(url, requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (error) {
                    reject(new Error(`解析响应失败: ${error.message}`));
                }
            });
        });

        req.on('error', reject);

        if (options.body) {
            req.write(options.body);
        }

        req.end();
    });
}
