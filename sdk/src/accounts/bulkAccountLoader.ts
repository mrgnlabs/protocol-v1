import { Commitment, Connection, PublicKey } from '@solana/web3.js';

type onAccountChange = (data: Buffer | null) => void;

type AccountToLoad = {
	publicKey: PublicKey;
	onChange: onAccountChange;
};

type RPCResponse = {
	slot: number;
	buffer: Buffer | null;
};

export class BulkAccountLoader {
	connection: Connection;
	commitment: Commitment;
	pollingFrequency: number;

	accountsToLoad = new Map<string, AccountToLoad>();
	rpcResponses = new Map<string, RPCResponse>();

	intervalId?: NodeJS.Timer;

	public constructor(
		connection: Connection,
		commitment: Commitment,
		pollingFrequency: number
	) {
		this.connection = connection;
		this.commitment = commitment;
		this.pollingFrequency = pollingFrequency;
	}

	public addAccount(accountToLoad: AccountToLoad): void {
		this.accountsToLoad.set(accountToLoad.publicKey.toString(), accountToLoad);
	}

	public removeAccount(publicKey: PublicKey): void {
		this.accountsToLoad.delete(publicKey.toString());
	}

	public async load(): Promise<void> {
		const accountsToLoadEntries = [...this.accountsToLoad];
		if (accountsToLoadEntries.length === 0) {
			return;
		}

		const args = [
			accountsToLoadEntries.map((entry) => {
				const { publicKey } = entry[1];
				return publicKey.toBase58();
			}),
			{ commitment: this.commitment },
		];

		// @ts-ignore
		const rpcResponse = await this.connection._rpcRequest(
			'getMultipleAccounts',
			args
		);

		const newSlot = rpcResponse.result.context.slot;

		for (const i in accountsToLoadEntries) {
			const [key, accountToLoad] = accountsToLoadEntries[i];
			const oldRPCResponse = this.rpcResponses.get(key);

			let newBuffer: Buffer | null = null;
			if (rpcResponse.result.value[i]) {
				const raw: string = rpcResponse.result.value[i].data[0];
				const dataType = rpcResponse.result.value[i].data[1];
				newBuffer = Buffer.from(raw, dataType);
			}

			if (!oldRPCResponse) {
				this.rpcResponses.set(key, {
					slot: newSlot,
					buffer: newBuffer,
				});
				accountToLoad.onChange(newBuffer);
				continue;
			}

			if (newSlot <= oldRPCResponse.slot) {
				continue;
			}

			const oldBuffer = oldRPCResponse.buffer;
			if (newBuffer && (!oldBuffer || !newBuffer.equals(oldBuffer))) {
				this.rpcResponses.set(key, {
					slot: newSlot,
					buffer: newBuffer,
				});
				accountToLoad.onChange(newBuffer);
			}
		}
	}

	public startPolling(): void {
		if (this.intervalId) {
			return;
		}

		this.intervalId = setInterval(this.load.bind(this), this.pollingFrequency);
	}

	public stopPolling(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
	}
}
