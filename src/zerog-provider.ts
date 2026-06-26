/**
 * buildZerogProvider — construct a TEE-verified 0G Compute inference provider
 * (the NPC "brain") from the engine's ZeroGBrokerProvider. Replicates the proven
 * funding sequence from aigg-mud-demo's run-0g-verify.ts: build a broker over the
 * wallet, pick a TeeML chat service, fund the ledger, transfer to the provider
 * sub-account. Returns null when the env/funds are missing so the caller can fall
 * back to a scripted brain (the town still works, just without live 0G thoughts).
 */
import { createRequire } from 'node:module';
import type { InferenceProvider } from '@aigg/npc-agent';

// The 0G compute SDK ships a broken ESM build (a chunk imports a missing internal
// export 'C') that crashes under `await import()` in this "type":"module" package.
// Its CJS build is fine, so load it via require. (Storage SDK + ethers ESM are OK.)
const nodeRequire = createRequire(import.meta.url);

export async function buildZerogProvider(): Promise<InferenceProvider | null> {
  const pk = process.env.ZEROG_WALLET_PK || process.env.PRIVATE_KEY;
  if (!pk) {
    console.warn('[0gtown] no ZEROG_WALLET_PK/PRIVATE_KEY → falling back to scripted brain (no live 0G Compute)');
    return null;
  }
  try {
    const { ethers }: any = await import('ethers');
    const { createZGComputeNetworkBroker }: any = nodeRequire('@0gfoundation/0g-compute-ts-sdk');
    const { ZeroGBrokerProvider }: any = await import('@aigg/npc-agent');

    const mainnet = (process.env.ZEROG_NET || 'testnet').toLowerCase() === 'mainnet';
    const rpc = process.env.ZEROG_RPC || (mainnet ? 'https://evmrpc.0g.ai' : 'https://evmrpc-testnet.0g.ai');
    const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpc));
    console.log('[0gtown] 0G wallet', wallet.address, '· net', mainnet ? 'mainnet' : 'testnet');

    const broker = await createZGComputeNetworkBroker(wallet);
    const svcs = await broker.inference.listService();
    const isTeeChat = (s: any) =>
      String(s.verifiability ?? '').toLowerCase().includes('tee') &&
      String(s.serviceType ?? '').includes('chat');
    // Pick the brain: ZEROG_PROVIDER (exact address) > ZEROG_MODEL (model name substring) > first TeeML chat.
    const wantProvider = (process.env.ZEROG_PROVIDER || '').toLowerCase();
    const wantModel = (process.env.ZEROG_MODEL || '').toLowerCase();
    let tee: any;
    if (wantProvider) tee = svcs.find((s: any) => String(s.provider).toLowerCase() === wantProvider);
    if (!tee && wantModel) tee = svcs.find((s: any) => isTeeChat(s) && String(s.model ?? '').toLowerCase().includes(wantModel));
    if (!tee && (wantProvider || wantModel))
      console.warn(`[0gtown] ZEROG_MODEL/PROVIDER "${process.env.ZEROG_MODEL || process.env.ZEROG_PROVIDER}" not found in listService() → using default`);
    if (!tee) tee = svcs.find(isTeeChat) || svcs[0];
    if (!tee) { console.warn('[0gtown] no 0G inference services available → fallback'); return null; }

    if (process.env.ZEROG_SKIP_DEPOSIT === '1') {
      console.log('[0gtown] ZEROG_SKIP_DEPOSIT=1 — reusing existing ledger funds (no new deposit)');
    } else {
      const deposit = Number(process.env.ZEROG_DEPOSIT || '0.05');
      try { await broker.ledger.depositFund(deposit); console.log('[0gtown] deposited', deposit, '$0G to compute ledger'); }
      catch (e: any) { console.warn('[0gtown] ledger deposit note:', e?.message?.slice(0, 120)); }
      try { await broker.ledger.transferFund(tee.provider, 'inference', BigInt(Math.floor(deposit * 1e18))); }
      catch (e: any) { console.warn('[0gtown] ledger transfer note:', e?.message?.slice(0, 120)); }
    }

    console.log('[0gtown] 0G Compute provider:', tee.provider, tee.model, tee.verifiability);
    return new ZeroGBrokerProvider({ broker, providerAddress: tee.provider });
  } catch (e: any) {
    console.warn('[0gtown] 0G provider build failed → fallback:', e?.message?.slice(0, 160));
    return null;
  }
}
