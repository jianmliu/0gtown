/**
 * FallbackProvider — a zero-dependency scripted "brain" used when live 0G Compute
 * isn't configured (no wallet key / no funds). The town still works; NPC replies
 * are canned and clearly NOT TEE-verified (the client shows a "local" badge).
 *
 * Must return `text` as an AgentIntent JSON ({say, effects, emotion}) because the
 * engine's LlmAgent parses the provider's text into an intent.
 */
import type { InferenceProvider } from '@onchainpal/npc-agent';

const LINES = [
  'Well met, friend! What brings you to 0gtown today?',
  'Ha, you have a kind face — sit, sit, tell me the news.',
  'Mm, the noodles are good today. And your story?',
  'You flatter me. What is it you really want, hm?',
];

export class FallbackProvider implements InferenceProvider {
  readonly id = 'fallback-scripted';
  private i = 0;
  async complete(_req: any): Promise<any> {
    const say = LINES[this.i++ % LINES.length];
    return {
      text: JSON.stringify({ say, effects: [], emotion: 'warm' }),
      usage: { model: 'fallback', inputTokens: 8, outputTokens: 12, gccCost: 0 },
      // no attestation — fallback is not TEE-verified, and we never fake one
    };
  }
}
