'use strict';
// Fake `muse serve`: JSON-RPC 2.0 over JSONL on stdio.
// Exercises the MspEngine without a real CLI: handshake, session start/resume,
// a scripted turn with an approval round trip, token/usage events, list/read.
const fs = require('node:fs');
const readline = require('node:readline');

const PIN = 'sha256:7469c9e352e67def4a59df7e439984d7194fa351e1c8b7abb34060fd977ced81';
const SES = 'sess-mock-1';
const NOW = Date.now();
// --legacy emulates a CLI older than session MCP: it rejects the sessionMcp
// capability at handshake, like hosts that predate it.
const LEGACY = process.argv.includes('--legacy');
let requestedCaps = null;
const startedConfigs = {}; // sessionId -> mcpServers JSON (loaded-session memory)
const USAGE = {
  tier: 'mock-pro',
  observedAtMs: NOW,
  window: { usedPercent: 12.5, resetsAtMs: NOW + 3600 * 1000, windowDurationMins: 300 },
  weekly: { usedPercent: 3.1, resetsAtMs: NOW + 6 * 24 * 3600 * 1000 },
};

let turnSeq = 0;
let pendingFinish = null;

const send = (o) => {
  process.stdout.write(`${JSON.stringify(o)}\n`);
};
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

function finishTurn(sid, turnId) {
  notify('item/completed', {
    sessionId: sid,
    item: {
      itemId: 'it-1',
      revision: 1,
      kind: 'agentMessage',
      turnId,
      status: 'completed',
      text: '안녕하세요! mock 응답입니다.',
    },
  });
  notify('session/tokenUsage', {
    sessionId: sid,
    turnId,
    usage: { inputTokens: 11, outputTokens: 22 },
    cumulative: { totalTokens: 33 },
    modelId: 'mock-model',
    durationMs: 150,
  });
  notify('usage/changed', { sessionId: sid, usage: USAGE });
  notify('turn/completed', {
    sessionId: sid,
    turnId,
    terminal: 'completed',
    durationMs: 150,
    usage: { inputTokens: 11, outputTokens: 22 },
    reason: null,
  });
  notify('session/listChanged', { sessionId: sid });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
process.stdin.on('end', () => process.exit(0));

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!msg || msg.id === undefined) return; // client notification (e.g. initialized)
  const p = msg.params || {};
  const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result });
  // The SDK rejects error responses without data.kind, like the real host.
  const replyError = (code, message, kind = 'commandRejected') => (
    send({ jsonrpc: '2.0', id: msg.id, error: { code, message, data: { kind } } })
  );

  const hasMcpConfig = p.config?.mcpServers && Object.keys(p.config.mcpServers).length > 0;
  if (['session/start', 'session/resume'].includes(msg.method) && hasMcpConfig && !(requestedCaps || []).includes('sessionMcp')) {
    // Mirrors the real host: config without the granted capability is refused.
    return replyError(-32602, 'session MCP configuration requires the sessionMcp capability');
  }
  if (process.env.MUSICIAN_TEST_BROWSER_CONFIG === '1' && ['session/start', 'session/resume'].includes(msg.method)) {
    const server = p.config?.mcpServers?.['musician-browser'];
    if (server?.transport !== 'stdio' || server.command !== 'node') {
      process.stderr.write('Missing browser session configuration\n');
      process.exit(1);
    }
  }
  switch (msg.method) {
    case 'initialize': {
      requestedCaps = p.capabilities?.requestedCapabilities || p.requestedCapabilities || [];
      if (process.env.MUSICIAN_TEST_CAPS_FILE) {
        try {
          fs.writeFileSync(process.env.MUSICIAN_TEST_CAPS_FILE, JSON.stringify(requestedCaps));
        } catch {
          /* best effort */
        }
      }
      if (LEGACY && requestedCaps.includes('sessionMcp')) {
        return replyError(-32602, 'unknown capability: sessionMcp');
      }
      return reply({
        serverInfo: { name: 'mock-muse', version: '0.0.0-mock' },
        schema: { fingerprint: PIN },
        sessionDurability: 'durable',
      });
    }
    case 'session/start': {
      startedConfigs[SES] = JSON.stringify(p.config?.mcpServers ?? null);
      return reply({ session: { sessionId: SES } });
    }
    case 'session/resume': {
      const sid = p.sessionId || SES;
      const cur = JSON.stringify(p.config?.mcpServers ?? null);
      // Mirrors the real host: a loaded session rejects MCP config changes,
      // while unknown (fresh-host) sessions accept whatever resume carries.
      if (sid in startedConfigs && startedConfigs[sid] !== cur) {
        return replyError(-32000, 'session MCP configuration conflicts with the loaded session runtime');
      }
      startedConfigs[sid] = cur;
      return reply({
        session: { sessionId: sid },
        history: {
          items: [
            { kind: 'userMessage', displayText: '이전 질문' },
            { kind: 'agentMessage', text: '이전 답변' },
          ],
        },
      });
    }
    case 'turn/start': {
      turnSeq += 1;
      const turnId = `turn-mock-${turnSeq}`;
      const sid = p.sessionId || SES;
      reply({ disposition: 'started', turnId });
      setTimeout(() => notify('turn/started', { sessionId: sid, turnId, commandId: p.commandId }), 20);
      setTimeout(
        () =>
          notify('item/started', {
            sessionId: sid,
            item: { itemId: 'it-1', revision: 0, kind: 'agentMessage', turnId, status: 'inProgress', text: '안녕' },
          }),
        40,
      );
      setTimeout(
        () =>
          notify('approval/requested', {
            sessionId: sid,
            approvalId: 'appr-1',
            currentRequirementId: { approvalId: 'appr-1', sourceIndex: 0 },
            turnId,
            toolName: 'shell',
            subject: { kind: 'shell', command: 'dir' },
            rawArgs: 'dir',
            availableChoices: [
              { choiceId: 'allow-once', label: '한 번 허용', decision: 'allow', scope: 'once', acceptsFeedback: false },
              { choiceId: 'deny', label: '거부', decision: 'deny', scope: 'once', acceptsFeedback: true },
            ],
          }),
        60,
      );
      // The turn only completes after the client decides the approval.
      pendingFinish = () => finishTurn(sid, turnId);
      return undefined;
    }
    case 'approval/decide': {
      reply({ terminal: true });
      setTimeout(() => {
        notify('approval/resolved', { sessionId: p.sessionId || SES, approvalId: p.approvalId || 'appr-1' });
        if (pendingFinish) {
          const f = pendingFinish;
          pendingFinish = null;
          f();
        }
      }, 20);
      return undefined;
    }
    case 'session/list':
      return reply({
        sessions: [
          {
            sessionId: SES,
            title: 'Mock 세션',
            name: null,
            workspaceRoot: p.workspaceRoot || null,
            status: 'active',
            turnCount: 2,
            updatedAt: new Date().toISOString(),
            modelId: 'mock-model',
          },
        ],
      });
    case 'usage/read':
      return reply({ usage: USAGE });
    case 'model/list':
      return reply({
        models: [{ modelId: 'mock-model', displayLabel: 'Mock Model', isActive: true, isDefault: true }],
      });
    case 'userInput/answer':
      return reply({ commandId: p.commandId, status: 'accepted', userInputId: p.userInputId });
    case 'userInput/cancel':
      return reply({ commandId: p.commandId, status: 'accepted', userInputId: p.userInputId });
    case 'turn/cancel':
    case 'session/setModel':
    case 'session/setApprovalMode':
    case 'session/setReasoningEffort':
      return reply({});
    default:
      return replyError(-32601, `mock: unknown method ${msg.method}`);
  }
});
