/**
 * Minimal MCP stdio client used by the demo and the end-to-end test.
 *
 * It speaks the real wire format (newline-delimited JSON-RPC over stdio) rather
 * than calling the handler directly, so the test covers the transport too.
 */

import { spawn } from 'node:child_process';

/**
 * @param {string} serverPath
 * @param {object[]} requests messages to send, in order
 * @param {{timeoutMs?: number, nodePath?: string}} [options]
 * @returns {Promise<{responses: object[], stderr: string}>}
 */
export function callMcpServer(serverPath, requests, options = {}) {
  const expected = requests.filter((request) => request.id !== undefined && request.id !== null).length;

  return new Promise((resolve, reject) => {
    const child = spawn(options.nodePath || process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses = [];
    let buffer = '';
    let stderr = '';
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) {
        reject(error);
      } else {
        resolve({ responses, stderr });
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`MCP server did not answer ${expected} request(s) in time. stderr: ${stderr.slice(0, 400)}`));
    }, options.timeoutMs ?? 20000);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line !== '') {
          try {
            responses.push(JSON.parse(line));
          } catch {
            stderr += `\n[unparseable] ${line}`;
          }
        }
        newline = buffer.indexOf('\n');
      }
      if (responses.length >= expected) {
        finish(null);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => finish(error));
    child.on('exit', () => {
      if (responses.length >= expected) {
        finish(null);
      } else {
        finish(new Error(`MCP server exited early. stderr: ${stderr.slice(0, 400)}`));
      }
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
  });
}
