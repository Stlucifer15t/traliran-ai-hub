/*
 * mcp-stdio.js - MCP servers that run as a process inside the Linux environment.
 *
 * A stdio server speaks newline-delimited JSON-RPC on stdin/stdout. It runs through
 * LinuxShell.mcpStart (plain pipes, not a terminal), so its protocol bytes are not
 * altered. The protocol logic (initialize, tools/list, tools/call) comes from McpClient
 * in mcp.js; this file only replaces the transport.
 *
 * Android app only. Loaded after mcp.js.
 */
(function (g) {
    'use strict';

    const RPC_TIMEOUT_MS = 60000;

    function linuxShell() {
        const cap = g.Capacitor;
        return cap && cap.Plugins && cap.Plugins.LinuxShell ? cap.Plugins.LinuxShell : null;
    }

    /**
     * One listener per event for all servers, routed by handle. Capacitor delivers events to
     * every listener, so registering per client would multiply the work.
     */
    const Router = {
        handlers: new Map(),
        installed: false,
        install(LS) {
            if (this.installed) return;
            this.installed = true;
            LS.addListener('mcpMessage', (ev) => {
                const h = this.handlers.get(ev.handle);
                if (h) h.onLine(ev.line);
            });
            LS.addListener('mcpExit', (ev) => {
                const h = this.handlers.get(ev.handle);
                this.handlers.delete(ev.handle);
                if (h) h.onExit(ev.code);
            });
        },
    };

    class StdioMcpClient extends McpClient {
        constructor(config) {
            super(config);
            this.transport = 'stdio';
            this.command = config.command || '';
            this.cwd = config.cwd || '/root/projects';
            this.handle = null;
            this._pending = new Map();
        }

        async _open() {
            if (this.handle !== null) return;
            const LS = linuxShell();
            if (!LS) throw new Error('Linux MCP servers need the Android app');
            Router.install(LS);
            const res = await LS.mcpStart({ command: this.command, cwd: this.cwd });
            this.handle = res.handle;
            Router.handlers.set(this.handle, {
                onLine: (line) => this._onLine(line),
                onExit: (code) => this._onExit(code),
            });
        }

        _onLine(line) {
            let msg;
            try {
                msg = JSON.parse(line);
            } catch (_) {
                return; // not JSON-RPC (some servers print log lines to stdout)
            }
            if (msg.id === undefined || msg.id === null) return; // a notification from the server
            const key = String(msg.id);
            const waiter = this._pending.get(key);
            if (!waiter) return;
            this._pending.delete(key);
            if (msg.error) {
                waiter.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
                waiter.resolve(msg.result);
            }
        }

        _onExit(code) {
            this.connected = false;
            this.handle = null;
            const err = new Error('MCP server exited (code ' + code + ')');
            for (const waiter of this._pending.values()) waiter.reject(err);
            this._pending.clear();
        }

        async _rpc(method, params, { notification = false } = {}) {
            await this._open();
            const LS = linuxShell();
            const payload = { jsonrpc: '2.0', method, params: params || {} };
            if (notification) {
                await LS.mcpSend({ handle: this.handle, message: JSON.stringify(payload) });
                return null;
            }
            const id = String(++this._idCounter);
            payload.id = id;
            const reply = new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (this._pending.delete(id)) reject(new Error(method + ' timed out'));
                }, RPC_TIMEOUT_MS);
                this._pending.set(id, {
                    resolve: (v) => { clearTimeout(timer); resolve(v); },
                    reject: (e) => { clearTimeout(timer); reject(e); },
                });
            });
            await LS.mcpSend({ handle: this.handle, message: JSON.stringify(payload) });
            return reply;
        }

        /** Stops the server process. Its tools are removed from the registry on the next rebuild. */
        async close() {
            const LS = linuxShell();
            const handle = this.handle;
            this.connected = false;
            this.handle = null;
            if (handle !== null && LS) {
                await LS.mcpStop({ handle }).catch(() => {});
            }
        }
    }

    /** Adds a stdio server to the MCP manager and saves it. The command runs in Linux. */
    function addStdio(config) {
        const name = (config.name || '').trim();
        const command = (config.command || '').trim();
        if (!name || !command) throw new Error('A server needs a name and a command');
        if (command.length > 2000) throw new Error('Command is too long');
        const entry = {
            id: 'mcp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name,
            transport: 'stdio',
            command,
            cwd: '/root/projects',
        };
        MCP_MANAGER.servers.push(entry);
        MCP_MANAGER.save();
        return entry;
    }

    g.StdioMcpClient = StdioMcpClient;
    MCP_MANAGER.addStdio = addStdio;
})(window);
