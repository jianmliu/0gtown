/**
 * zerog-openai-shim — a tiny OpenAI-compatible `/v1/chat/completions` server backed by
 * the engine's InferenceProvider (in practice the same TEE-attested ZeroGBrokerProvider
 * that powers `talk`). It lets the external aigg-memory sidecar run belief synthesis
 * (reflect/dream) through 0G Compute over the SAME broker path — so learning is enclave-
 * verified exactly like NPC replies, not just "0G Router" inference.
 *
 * Flow:  aigg-memory  ──POST /v1/chat/completions──▶  shim  ──provider.complete()──▶  0G broker (TEE)
 *
 * Security: binds 127.0.0.1 by default (local sidecar only) and — because every call
 * spends real ledger $0G — supports an optional bearer token (MEMORY_REFLECT_SHIM_TOKEN),
 * which the sidecar sends when launched with `aigg-memory serve --aigg-key <token>`.
 */
import http from 'node:http';
import type { InferenceProvider } from '@aigg/npc-agent';

export interface ShimOptions { port?: number; host?: string; token?: string; }

/** Start the shim over an InferenceProvider. Returns the base URL (…/v1) + a close(). */
export function startZerogOpenAiShim(provider: InferenceProvider, opts: ShimOptions = {}) {
  const port = opts.port ?? Number(process.env.MEMORY_REFLECT_SHIM_PORT || 8139);
  const host = opts.host ?? process.env.MEMORY_REFLECT_SHIM_HOST ?? '127.0.0.1';
  const token = opts.token ?? process.env.MEMORY_REFLECT_SHIM_TOKEN;

  const server = http.createServer(async (req, res) => {
    const json = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/healthz') return json(200, { ok: true });
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) return json(404, { error: 'not found' });
    if (token && req.headers.authorization !== `Bearer ${token}`) return json(401, { error: 'unauthorized' });

    try {
      const body = await readJson(req);
      const msgs: Array<{ role?: string; content?: string }> = Array.isArray(body.messages) ? body.messages : [];
      // invert the OpenAI messages array back into the engine's { system, prompt }
      const system = msgs.filter((m) => m.role === 'system').map((m) => m.content ?? '').join('\n\n') || undefined;
      const prompt = msgs.filter((m) => m.role !== 'system').map((m) => String(m.content ?? '')).join('\n\n');

      const out = await provider.complete({ prompt, system, ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}) });
      const sig = out.attestation?.signature;
      const verified = typeof sig === 'string' && sig.startsWith('0g-teeml:verified:');
      const inTok = out.usage?.inputTokens ?? 0, outTok = out.usage?.outputTokens ?? 0;
      json(200, {
        id: sig && sig.includes(':') ? sig.split(':').pop() : 'chatcmpl-0gtown',
        object: 'chat.completion',
        created: 0, // no wall-clock in this env; the sidecar doesn't rely on it
        model: body.model ?? out.usage?.model ?? out.attestation?.model ?? '0g',
        choices: [{ index: 0, message: { role: 'assistant', content: out.text ?? '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok },
        // non-standard extras: let callers that care see the TEE verdict
        '0g_tee_verified': verified,
        '0g_attestation': sig ?? null,
      });
    } catch (e: any) {
      json(500, { error: String(e?.message || e).slice(0, 200) });
    }
  });

  server.listen(port, host);
  const url = `http://${host}:${port}/v1`;
  return { server, url, port, host, close: () => server.close() };
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let d = ''; let killed = false;
    req.on('data', (c) => { d += c; if (d.length > 2_000_000) { killed = true; req.destroy(); } });
    req.on('end', () => { if (killed) return reject(new Error('request too large')); try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
