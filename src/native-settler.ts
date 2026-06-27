/**
 * buildSettler — construct the on-chain settlement layer from env, mirroring
 * buildZerogProvider. Returns null when ECON_ONCHAIN!=='1' or the keys are
 * missing, so the `settle` command degrades to a graceful no-op (the town runs
 * fine without on-chain settlement).
 */
import { Native0gSettlementLayer, ViemNativeChain } from '@aigg/onchain';
import { privateKeyToAccount } from 'viem/accounts';
import { parseEther } from 'viem';

export async function buildSettler(): Promise<Native0gSettlementLayer | null> {
  if (process.env.ECON_ONCHAIN !== '1') return null;
  const npcMnemonic = process.env.NPC_MNEMONIC;
  const treasuryPk = (process.env.ZEROG_WALLET_PK || process.env.PRIVATE_KEY) as `0x${string}` | undefined;
  if (!npcMnemonic || !treasuryPk) {
    console.warn('[0gtown] ECON_ONCHAIN=1 but NPC_MNEMONIC / ZEROG_WALLET_PK missing → settle disabled');
    return null;
  }
  const net = (process.env.ZEROG_NET || 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
  const treasuryAddress = privateKeyToAccount(treasuryPk).address;
  const chain = new ViemNativeChain({ net, rpcUrl: process.env.ZEROG_RPC, npcMnemonic, treasuryPrivateKey: treasuryPk });
  const weiPerUnit = process.env.ECON_WEI_PER_UNIT ? parseEther(process.env.ECON_WEI_PER_UNIT) : undefined;
  console.log('[0gtown] on-chain settlement ON · net', net, '· treasury', treasuryAddress);
  return new Native0gSettlementLayer({ chain, npcMnemonic, treasuryAddress, weiPerUnit });
}
