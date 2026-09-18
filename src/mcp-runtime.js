/**
 * The MCP server runtime (stdio transport, newline-delimited JSON-RPC 2.0).
 *
 * This module is inlined verbatim into the generated `server.mjs`, which is why
 * it keeps its imports to `node:` builtins only — the generated file has to run
 * with zero install, in any folder, forever.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { searchIndex, listDocuments } from './search.js';

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {string} path
 * @returns {string}
 */
function sanitizeRelativePath(path) {
  const cleaned = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (cleaned === '' || cleaned.includes('..')) {
    return '';
  }
  return cleaned;
}

/**
 * @param {object} options
 * @param {string} options.dir folder containing index.json and docs/
 * @param {string} [options.name]
 * @param {string} [options.version]
 * @returns {{start: () => void, handle: (message: unknown) => object|null, tools: object[], loadIndex: () => object}}
 */
export function createServer(options) {
  const dir = options.dir;
  const serverName = options.name || 'hanmcp';
  const serverVersion = options.version || '0.1.0';

  let cachedIndex = null;

  const loadIndex = () => {
    if (cachedIndex === null) {
      cachedIndex = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    }
    return cachedIndex;
  };

  const tools = [
    {
      name: 'search_docs',
      description:
        'Search this documentation set and return the most relevant passages. Prefer this over guessing: call it before answering anything about the covered project. Returns ranked snippets with source URLs.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language question or keyword query. Chinese and English both supported.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of passages to return (default 5, max 20).',
            minimum: 1,
            maximum: 20,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_doc',
      description:
        'Read the complete markdown of one documentation page. Use the `path` value returned by search_docs or list_docs.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Document path such as "guide/getting-started.md".',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_docs',
      description: 'List every documentation page in this set, with its path, title, and source URL.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ];

  const callTool = (name, args) => {
    const index = loadIndex();

    if (name === 'search_docs') {
      const query = typeof args.query === 'string' ? args.query : '';
      if (query.trim() === '') {
        return { text: 'Missing required argument: query', isError: true };
      }
      const rawLimit = Number(args.limit);
      const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.trunc(rawLimit))) : 5;
      const results = searchIndex(index, query, limit);
      if (results.length === 0) {
        return { text: `No passages matched "${query}" in ${index.stats.pages} pages.` };
      }
      const body = results
        .map((hit, position) => {
          const lines = [
            `${position + 1}. ${hit.title}${hit.heading && hit.heading !== hit.title ? ` — ${hit.heading}` : ''}`,
            `   source: ${hit.url}`,
            `   path: ${hit.path}`,
            `   score: ${hit.score}`,
            '',
            hit.text.trim(),
          ];
          return lines.join('\n');
        })
        .join('\n\n---\n\n');
      return { text: `${results.length} of ${index.stats.chunks} indexed passages for "${query}":\n\n${body}` };
    }

    if (name === 'get_doc') {
      const relative = sanitizeRelativePath(args.path);
      if (relative === '') {
        return { text: `Invalid path: ${String(args.path)}`, isError: true };
      }
      try {
        const markdown = readFileSync(join(dir, 'docs', relative), 'utf8');
        return { text: markdown };
      } catch {
        const target = index.docs.find((doc) => doc.path === relative);
        if (target === undefined) {
          return { text: `No document at ${relative}. Call list_docs to see what is available.`, isError: true };
        }
        const text = index.chunks
          .filter((chunk) => chunk.doc === target.id)
          .map((chunk) => chunk.text)
          .join('\n\n');
        return { text };
      }
    }

    if (name === 'list_docs') {
      const documents = listDocuments(index);
      const body = documents
        .map((doc) => `- ${doc.path}\n  ${doc.title}\n  ${doc.url}`)
        .join('\n');
      return { text: `${documents.length} pages from ${index.source || 'documentation'}:\n\n${body}` };
    }

    return { text: `Unknown tool: ${name}`, isError: true };
  };

  const handle = (message) => {
    if (!isObject(message) || typeof message.method !== 'string') {
      return null;
    }
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    const requestParams = isObject(params) ? params : {};

    if (method.startsWith('notifications/')) {
      return null;
    }

    if (method === 'initialize') {
      const requested = typeof requestParams.protocolVersion === 'string' ? requestParams.protocolVersion : '';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: requested === '' ? DEFAULT_PROTOCOL_VERSION : requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: serverName, version: serverVersion },
          instructions:
            'Documentation server generated by hanmcp. Call search_docs before answering questions about this project, then get_doc to read a full page.',
        },
      };
    }

    if (method === 'ping') {
      return isNotification ? null : { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return isNotification ? null : { jsonrpc: '2.0', id, result: { tools } };
    }

    if (method === 'tools/call') {
      const toolName = typeof requestParams.name === 'string' ? requestParams.name : '';
      const args = isObject(requestParams.arguments) ? requestParams.arguments : {};
      if (toolName === '') {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params: name is required' } };
      }
      const outcome = callTool(toolName, args);
      const result = { content: [{ type: 'text', text: outcome.text }] };
      if (outcome.isError === true) {
        result.isError = true;
      }
      return { jsonrpc: '2.0', id, result };
    }

    if (isNotification) {
      return null;
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  };

  const start = () => {
    const reader = createInterface({ input: process.stdin, terminal: false });
    reader.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed === '') {
        return;
      }
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        return;
      }
      const response = handle(message);
      if (response !== null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    });
    process.stderr.write(`${serverName} ${serverVersion} ready: ${dir}\n`);
  };

  return { start, handle, tools, loadIndex };
}
