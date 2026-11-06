import { JsonRpcProvider } from 'ethers';
// Deliberately non-configurable remote transport: loopback, fixed local chain,
// no DNS, credentials, URL paths, redirects, or public endpoint fallback.
export class LocalEvm {
  readonly provider: JsonRpcProvider;
  constructor(readonly port: number) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_local_port');
    this.provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  }
  async assertLocal() {
    if (await this.provider.send('eth_chainId', []) !== '0x7a69') throw new Error('local_chain_required');
    const version: unknown = await this.provider.send('web3_clientVersion', []);
    if (typeof version !== 'string' || !version.toLowerCase().includes('anvil')) throw new Error('local_anvil_required');
  }
  async sendRaw(raw: string) {
    await this.assertLocal();
    return this.provider.send('eth_sendRawTransaction', [raw]) as Promise<string>;
  }
  close() { this.provider.destroy(); }
}
