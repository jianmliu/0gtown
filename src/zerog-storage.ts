/**
 * ZeroGStorageClient — 0G Storage client for 0gtown's "memory anchor" layer.
 *
 * Vendored verbatim from aigg-mud-demo (contracts/gateway/zerog-storage.ts) — the
 * engine (aigg-agent-kit) doesn't house a storage client yet, and it's only ~70
 * lines, so 0gtown carries its own copy. upload(data,name)→rootHash and
 * download(rootHash)→data; the rootHash is 0G's Merkle content-id, so the
 * round-trip is tamper-evident (anchor keccak(blob) on-chain, fetch by rootHash,
 * verify against the anchor).
 *
 * The real path wraps @0gfoundation/0g-storage-ts-sdk (peer dep: ethers), LAZY-
 * imported so the SDK is OPTIONAL — fromConfig() only needs it when actually
 * talking to 0G. The ZeroGTransport seam keeps the class unit-testable offline.
 */
import type { AutoDriveClient } from '@onchainpal/npc-agent';

/** the minimal byte-level seam — real = 0G SDK; fake = content-addressed in-memory. */
export interface ZeroGTransport {
  /** store bytes → return the 0G Storage rootHash (0x-prefixed Merkle root = content id). */
  put(bytes: Uint8Array): Promise<string>;
  /** fetch the bytes stored under a rootHash. */
  get(rootHash: string): Promise<Uint8Array>;
}

export interface ZeroGConfig {
  /** 0G Storage indexer RPC, e.g. the Galileo testnet indexer. */
  indexerRpc: string;
  /** the 0G EVM RPC (the storage tx is posted here). */
  evmRpc: string;
  /** signer key (env only) — pays the storage tx. */
  privateKey: string;
}

export class ZeroGStorageClient implements AutoDriveClient {
  constructor(private readonly transport: ZeroGTransport) {}

  /** Build the real client over @0gfoundation/0g-storage-ts-sdk (lazy-imported optional dep). */
  static async fromConfig(cfg: ZeroGConfig): Promise<ZeroGStorageClient> {
    // dynamic import → the SDK + ethers are optional; only required on this path.
    const sdk: any = await import('@0gfoundation/0g-storage-ts-sdk' as string);
    const { ethers }: any = await import('ethers' as string);
    const provider = new ethers.JsonRpcProvider(cfg.evmRpc);
    const signer = new ethers.Wallet(cfg.privateKey, provider);
    const indexer = new sdk.Indexer(cfg.indexerRpc);
    return new ZeroGStorageClient({
      async put(bytes: Uint8Array): Promise<string> {
        const mem = new sdk.MemData(bytes);
        const [, treeErr] = await mem.merkleTree();
        if (treeErr) throw treeErr;
        const [tx, err] = await indexer.upload(mem, cfg.evmRpc, signer);
        if (err) throw err;
        return tx.rootHash as string;
      },
      async get(rootHash: string): Promise<Uint8Array> {
        const [blob, err] = await indexer.downloadToBlob(rootHash, { proof: true });
        if (err) throw err;
        return new Uint8Array(await blob.arrayBuffer());
      },
    });
  }

  async upload(data: string, _name: string): Promise<string> {
    return this.transport.put(new TextEncoder().encode(data));
  }

  async download(cid: string): Promise<string> {
    return new TextDecoder().decode(await this.transport.get(cid));
  }
}

/** 0G Galileo testnet defaults (verify the indexer URL against current 0G docs before mainnet). */
export const ZEROG_TESTNET = {
  evmRpc: 'https://evmrpc-testnet.0g.ai',
  indexerRpc: 'https://indexer-storage-testnet-turbo.0g.ai', // ‹verify current Galileo indexer›
} as const;
