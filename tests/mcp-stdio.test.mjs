import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, memoryStore } from './helpers.mjs';

// Browser globals the scripts expect.
globalThis.window = globalThis;
globalThis.localStorage = memoryStore();
// Persistence used by mcp.js (defined in db-connector.js in the app).
globalThis.STORAGE = memoryStore();
load('mcp.js');
load('mcp-stdio.js');

/**
 * A fake LinuxShell plugin. It records what the bridge sends, and it can emit server
 * output. `early` lines are emitted during mcpStart, before the start promise resolves.
 */
// One plugin object for the whole file, as in the app: the bridge installs its listeners
// once per page, so a new object per test would never receive events.
const listeners = {};
const LS = {
    sent: [],
    starts: [],
    early: [],
    lastHandle: 0,
    onSend: null,
    addListener(name, fn) { (listeners[name] ||= []).push(fn); },
    emit(name, ev) { for (const fn of listeners[name] || []) fn(ev); },
    async mcpStart(args) {
        LS.starts.push(args);
        // Handles are unique per process, as on the device.
        const handle = ++LS.lastHandle;
        for (const line of LS.early) LS.emit('mcpMessage', { handle, line });
        await new Promise((r) => setTimeout(r, 5));
        return { handle };
    },
    async mcpSend({ handle, message }) {
        const msg = JSON.parse(message);
        LS.sent.push(msg);
        if (LS.onSend) LS.onSend(msg, LS, handle);
    },
    async mcpStop() { return {}; },
};

/** Resets the shared fake for one test and returns it. */
function fakePlugin({ early = [], onSend = null } = {}) {
    LS.sent.length = 0;
    LS.starts.length = 0;
    LS.early = early;
    LS.onSend = onSend;
    globalThis.Capacitor = { Plugins: { LinuxShell: LS } };
    return LS;
}

/** Replies to the handshake the way an MCP server would. */
function handshakeServer(msg, LS, handle) {
    if (msg.method === 'initialize') {
        setTimeout(() => LS.emit('mcpMessage', { handle, line: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } }) }), 0);
    } else if (msg.method === 'tools/list') {
        const tools = [{ name: 'echo', description: 'Echoes', inputSchema: { type: 'object' } }];
        setTimeout(() => LS.emit('mcpMessage', { handle, line: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools } }) }), 0);
    } else if (msg.method === 'tools/call') {
        const text = msg.params.arguments.text;
        setTimeout(() => LS.emit('mcpMessage', { handle, line: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } }) }), 0);
    }
}

function newClient(extra = {}) {
    return new StdioMcpClient({ id: 'srv1', name: 'Test', transport: 'stdio', command: 'echo-server', cwd: '/root/projects', ...extra });
}

beforeEach(() => {
    delete globalThis.Capacitor;
});

test('connect runs the MCP handshake and lists tools over the native pipe', async () => {
    const LS = fakePlugin({ onSend: handshakeServer });
    const client = newClient();
    const tools = await client.connect();
    assert.equal(client.connected, true);
    assert.deepEqual(tools.map(t => t.name), ['echo']);
    assert.deepEqual(LS.sent.map(m => m.method), ['initialize', 'notifications/initialized', 'tools/list']);
    assert.equal(LS.starts.length, 1);
    assert.equal(LS.starts[0].command, 'echo-server');
});

test('replies that arrive before mcpStart resolves are not lost', async () => {
    const early = [JSON.stringify({ jsonrpc: '2.0', id: '1', result: { protocolVersion: '2024-11-05' } })];
    const LS = fakePlugin({ early, onSend: (msg, plugin, h) => {
        // Only tools/list is answered by the server; initialize was answered early.
        if (msg.method === 'tools/list') {
            setTimeout(() => plugin.emit('mcpMessage', { handle: h, line: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }) }), 0);
        }
    } });
    const client = newClient();
    await client.connect();
    assert.equal(client.connected, true);
    assert.equal(LS.starts.length, 1);
});

test('concurrent requests share one server process', async () => {
    const LS = fakePlugin({ onSend: (msg, plugin, h) => {
        if (msg.method === 'tools/call') handshakeServer(msg, plugin, h);
    } });
    const client = newClient();
    const [a, b] = await Promise.all([
        client._rpc('tools/call', { name: 'echo', arguments: { text: 'a' } }),
        client._rpc('tools/call', { name: 'echo', arguments: { text: 'b' } }),
    ]);
    assert.equal(LS.starts.length, 1, 'only one process is started');
    assert.equal(a.content[0].text, 'a');
    assert.equal(b.content[0].text, 'b');
});

test('callTool returns the formatted result', async () => {
    fakePlugin({ onSend: handshakeServer });
    const client = newClient();
    await client.connect();
    const out = await client.callTool('echo', { text: 'hello' });
    assert.match(String(out), /hello/);
});

test('a JSON-RPC error rejects the request with the server message', async () => {
    fakePlugin({ onSend: (msg, plugin, h) => {
        if (msg.method === 'tools/call') {
            setTimeout(() => plugin.emit('mcpMessage', { handle: h, line: JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -1, message: 'bad input' } }) }), 0);
        }
    } });
    const client = newClient({ id: 'srv2' });
    await client._open();
    await assert.rejects(client._rpc('tools/call', { name: 'x' }), /bad input/);
});

test('non-JSON log lines and server notifications are ignored', async () => {
    const LS = fakePlugin({ onSend: (msg, plugin, h) => {
        if (msg.method === 'tools/list') {
            plugin.emit('mcpMessage', { handle: h, line: 'starting up...' });
            plugin.emit('mcpMessage', { handle: h, line: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: {} }) });
            setTimeout(() => plugin.emit('mcpMessage', { handle: h, line: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }) }), 0);
        } else {
            handshakeServer(msg, plugin, h);
        }
    } });
    const client = newClient({ id: 'srv3' });
    await client.connect();
    assert.equal(client.connected, true);
    assert.ok(LS.starts.length === 1);
});

test('when the process exits, pending requests fail and the client disconnects', async () => {
    const LS = fakePlugin({ onSend: (msg, plugin, h) => {
        // Exit instead of answering.
        setTimeout(() => plugin.emit('mcpExit', { handle: h, code: 3 }), 0);
    } });
    const client = newClient({ id: 'srv4' });
    await assert.rejects(client.connect(), /exited \(code 3\)/);
    assert.equal(client.connected, false);
    assert.equal(client.handle, null);
    assert.equal(LS.starts.length, 1);
});

test('without the Android plugin the client refuses to start', async () => {
    delete globalThis.Capacitor;
    const client = newClient({ id: 'srv5' });
    await assert.rejects(client._open(), /need the Android app/);
});

test('addStdio validates input and saves the server', () => {
    MCP_MANAGER.servers = [];
    assert.throws(() => MCP_MANAGER.addStdio({ name: '', command: 'x' }), /needs a name and a command/);
    assert.throws(() => MCP_MANAGER.addStdio({ name: 'n', command: 'x'.repeat(2001) }), /too long/);
    const entry = MCP_MANAGER.addStdio({ name: ' fs ', command: ' npx server ' });
    assert.equal(entry.name, 'fs');
    assert.equal(entry.command, 'npx server');
    assert.equal(entry.transport, 'stdio');
    assert.equal(entry.cwd, '/root/projects');
    assert.equal(MCP_MANAGER.servers.length, 1);
});
