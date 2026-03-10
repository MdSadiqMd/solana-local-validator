import express from "express";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

const app = express();
app.use(express.json());

// Constants
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// State
interface Account {
  lamports: number;
  owner: PublicKey;
  data: Buffer;
  executable: boolean;
  rentEpoch: number;
}

class ValidatorState {
  accounts = new Map<string, Account>();
  slot = 0;
  blockHeight = 0;
  blockhashes = new Set<string>();
  signatures = new Map<string, { slot: number; err: null }>();

  getAccount(pubkey: PublicKey): Account | null {
    return this.accounts.get(pubkey.toBase58()) || null;
  }

  setAccount(pubkey: PublicKey, account: Account) {
    this.accounts.set(pubkey.toBase58(), account);
  }

  deleteAccount(pubkey: PublicKey) {
    this.accounts.delete(pubkey.toBase58());
  }

  getOrCreateAccount(pubkey: PublicKey): Account {
    let account = this.getAccount(pubkey);
    if (!account) {
      account = {
        lamports: 0,
        owner: SYSTEM_PROGRAM_ID,
        data: Buffer.alloc(0),
        executable: false,
        rentEpoch: 0,
      };
      this.setAccount(pubkey, account);
    }
    return account;
  }
}

const state = new ValidatorState();

// Helper functions
function readU32LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function readU64LE(buffer: Buffer, offset: number): bigint {
  return buffer.readBigUInt64LE(offset);
}

function writeU64LE(buffer: Buffer, value: bigint, offset: number) {
  buffer.writeBigUInt64LE(value, offset);
}

function writeU32LE(buffer: Buffer, value: number, offset: number) {
  buffer.writeUInt32LE(value, offset);
}

// System Program
function executeSystemProgram(
  instruction: TransactionInstruction,
  signers: Set<string>
) {
  const data = instruction.data;
  if (data.length < 4) throw new Error("Invalid system instruction");

  const discriminator = readU32LE(data, 0);

  if (discriminator === 0) {
    // CreateAccount
    if (instruction.keys.length < 2) throw new Error("Invalid CreateAccount");
    const from = instruction.keys[0].pubkey;
    const to = instruction.keys[1].pubkey;

    if (!signers.has(to.toBase58())) {
      throw new Error("New account must be a signer");
    }

    const lamports = Number(readU64LE(data, 4));
    const space = Number(readU64LE(data, 12));
    const owner = new PublicKey(data.slice(20, 52));

    const toAccount = state.getAccount(to);
    if (toAccount && (toAccount.lamports > 0 || toAccount.data.length > 0)) {
      throw new Error("Account already exists");
    }

    const fromAccount = state.getOrCreateAccount(from);
    if (fromAccount.lamports < lamports) {
      throw new Error("Insufficient funds");
    }

    fromAccount.lamports -= lamports;
    state.setAccount(to, {
      lamports,
      owner,
      data: Buffer.alloc(space),
      executable: false,
      rentEpoch: 0,
    });
  } else if (discriminator === 2) {
    // Transfer
    if (instruction.keys.length < 2) throw new Error("Invalid Transfer");
    const from = instruction.keys[0].pubkey;
    const to = instruction.keys[1].pubkey;

    if (!signers.has(from.toBase58())) {
      throw new Error("From account must be a signer");
    }

    const lamports = Number(readU64LE(data, 4));

    const fromAccount = state.getOrCreateAccount(from);
    if (fromAccount.lamports < lamports) {
      throw new Error("Insufficient funds");
    }

    const toAccount = state.getOrCreateAccount(to);
    fromAccount.lamports -= lamports;
    toAccount.lamports += lamports;
  } else {
    throw new Error(`Unknown system instruction: ${discriminator}`);
  }
}

// Token Program
function executeTokenProgram(
  instruction: TransactionInstruction,
  signers: Set<string>
) {
  const data = instruction.data;
  if (data.length < 1) throw new Error("Invalid token instruction");

  const discriminator = data[0];

  if (discriminator === 20) {
    // InitializeMint2
    if (instruction.keys.length < 1) throw new Error("Invalid InitializeMint2");
    const mint = instruction.keys[0].pubkey;
    const mintAccount = state.getAccount(mint);
    if (!mintAccount) throw new Error("Mint account does not exist");
    if (mintAccount.data.length !== 82) throw new Error("Invalid mint account size");

    // Check if already initialized
    if (mintAccount.data[45] === 1) {
      throw new Error("Mint already initialized");
    }

    const decimals = data[1];
    const mintAuthority = new PublicKey(data.slice(2, 34));
    const hasFreezeAuth = data[34];
    const freezeAuthority = hasFreezeAuth ? new PublicKey(data.slice(35, 67)) : null;

    // Write mint data
    writeU32LE(mintAccount.data, 1, 0); // mintAuthorityOption = 1 (Some)
    mintAuthority.toBuffer().copy(mintAccount.data, 4);
    writeU64LE(mintAccount.data, 0n, 36); // supply = 0
    mintAccount.data[44] = decimals;
    mintAccount.data[45] = 1; // isInitialized = 1
    if (freezeAuthority) {
      writeU32LE(mintAccount.data, 1, 46); // freezeAuthorityOption = 1
      freezeAuthority.toBuffer().copy(mintAccount.data, 50);
    } else {
      writeU32LE(mintAccount.data, 0, 46); // freezeAuthorityOption = 0
    }
  } else if (discriminator === 18) {
    // InitializeAccount3
    if (instruction.keys.length < 2) throw new Error("Invalid InitializeAccount3");
    const tokenAccount = instruction.keys[0].pubkey;
    const mint = instruction.keys[1].pubkey;
    const owner = new PublicKey(data.slice(1, 33));

    const account = state.getAccount(tokenAccount);
    if (!account) throw new Error("Token account does not exist");
    if (account.data.length !== 165) throw new Error("Invalid token account size");

    // Write token account data (no check for already initialized)
    mint.toBuffer().copy(account.data, 0);
    owner.toBuffer().copy(account.data, 32);
    writeU64LE(account.data, 0n, 64); // amount = 0
    // delegate option (36 bytes) - set to None (0)
    writeU32LE(account.data, 0, 72);
    account.data[108] = 1; // state = initialized
    // isNative option (12 bytes) - set to None (0)
    writeU32LE(account.data, 0, 109);
    // delegatedAmount (8 bytes) - set to 0
    writeU64LE(account.data, 0n, 121);
    // closeAuthority option (36 bytes) - set to None (0)
    writeU32LE(account.data, 0, 129);
  } else if (discriminator === 7) {
    // MintTo
    if (instruction.keys.length < 3) throw new Error("Invalid MintTo");
    const mint = instruction.keys[0].pubkey;
    const destination = instruction.keys[1].pubkey;
    const authority = instruction.keys[2].pubkey;

    if (!signers.has(authority.toBase58())) {
      throw new Error("Authority must be a signer");
    }

    const amount = readU64LE(data, 1);

    const mintAccount = state.getAccount(mint);
    if (!mintAccount) throw new Error("Mint does not exist");

    // Check mint authority
    const mintAuthorityOption = readU32LE(mintAccount.data, 0);
    if (mintAuthorityOption === 0) throw new Error("Mint has no authority");
    const mintAuthority = new PublicKey(mintAccount.data.slice(4, 36));
    if (!mintAuthority.equals(authority)) {
      throw new Error("Invalid mint authority");
    }

    const destAccount = state.getAccount(destination);
    if (!destAccount) throw new Error("Destination does not exist");

    // Update destination balance
    const currentAmount = readU64LE(destAccount.data, 64);
    writeU64LE(destAccount.data, currentAmount + amount, 64);

    // Update mint supply
    const currentSupply = readU64LE(mintAccount.data, 36);
    writeU64LE(mintAccount.data, currentSupply + amount, 36);
  } else if (discriminator === 3) {
    // Transfer
    if (instruction.keys.length < 3) throw new Error("Invalid Transfer");
    const source = instruction.keys[0].pubkey;
    const destination = instruction.keys[1].pubkey;
    const owner = instruction.keys[2].pubkey;

    if (!signers.has(owner.toBase58())) {
      throw new Error("Owner must be a signer");
    }

    const amount = readU64LE(data, 1);

    const sourceAccount = state.getAccount(source);
    if (!sourceAccount) throw new Error("Source does not exist");

    const sourceOwner = new PublicKey(sourceAccount.data.slice(32, 64));
    if (!sourceOwner.equals(owner)) {
      throw new Error("Invalid owner");
    }

    const sourceAmount = readU64LE(sourceAccount.data, 64);
    if (sourceAmount < amount) {
      throw new Error("Insufficient token balance");
    }

    const destAccount = state.getAccount(destination);
    if (!destAccount) throw new Error("Destination does not exist");

    writeU64LE(sourceAccount.data, sourceAmount - amount, 64);
    const destAmount = readU64LE(destAccount.data, 64);
    writeU64LE(destAccount.data, destAmount + amount, 64);
  } else if (discriminator === 12) {
    // TransferChecked
    if (instruction.keys.length < 4) throw new Error("Invalid TransferChecked");
    const source = instruction.keys[0].pubkey;
    const mint = instruction.keys[1].pubkey;
    const destination = instruction.keys[2].pubkey;
    const owner = instruction.keys[3].pubkey;

    if (!signers.has(owner.toBase58())) {
      throw new Error("Owner must be a signer");
    }

    const amount = readU64LE(data, 1);
    const decimals = data[9];

    const mintAccount = state.getAccount(mint);
    if (!mintAccount) throw new Error("Mint does not exist");
    if (mintAccount.data[44] !== decimals) {
      throw new Error("Decimals mismatch");
    }

    const sourceAccount = state.getAccount(source);
    if (!sourceAccount) throw new Error("Source does not exist");

    const sourceOwner = new PublicKey(sourceAccount.data.slice(32, 64));
    if (!sourceOwner.equals(owner)) {
      throw new Error("Invalid owner");
    }

    const sourceAmount = readU64LE(sourceAccount.data, 64);
    if (sourceAmount < amount) {
      throw new Error("Insufficient token balance");
    }

    const destAccount = state.getAccount(destination);
    if (!destAccount) throw new Error("Destination does not exist");

    writeU64LE(sourceAccount.data, sourceAmount - amount, 64);
    const destAmount = readU64LE(destAccount.data, 64);
    writeU64LE(destAccount.data, destAmount + amount, 64);
  } else if (discriminator === 8) {
    // Burn
    if (instruction.keys.length < 3) throw new Error("Invalid Burn");
    const tokenAccount = instruction.keys[0].pubkey;
    const mint = instruction.keys[1].pubkey;
    const owner = instruction.keys[2].pubkey;

    if (!signers.has(owner.toBase58())) {
      throw new Error("Owner must be a signer");
    }

    const amount = readU64LE(data, 1);

    const account = state.getAccount(tokenAccount);
    if (!account) throw new Error("Token account does not exist");

    const accountOwner = new PublicKey(account.data.slice(32, 64));
    if (!accountOwner.equals(owner)) {
      throw new Error("Invalid owner");
    }

    const currentAmount = readU64LE(account.data, 64);
    if (currentAmount < amount) {
      throw new Error("Insufficient token balance");
    }

    writeU64LE(account.data, currentAmount - amount, 64);

    const mintAccount = state.getAccount(mint);
    if (!mintAccount) throw new Error("Mint does not exist");
    const supply = readU64LE(mintAccount.data, 36);
    writeU64LE(mintAccount.data, supply - amount, 36);
  } else if (discriminator === 9) {
    // CloseAccount
    if (instruction.keys.length < 3) throw new Error("Invalid CloseAccount");
    const account = instruction.keys[0].pubkey;
    const destination = instruction.keys[1].pubkey;
    const owner = instruction.keys[2].pubkey;

    if (!signers.has(owner.toBase58())) {
      throw new Error("Owner must be a signer");
    }

    const tokenAccount = state.getAccount(account);
    if (!tokenAccount) throw new Error("Account does not exist");

    const accountOwner = new PublicKey(tokenAccount.data.slice(32, 64));
    if (!accountOwner.equals(owner)) {
      throw new Error("Invalid owner");
    }

    const balance = readU64LE(tokenAccount.data, 64);
    if (balance !== 0n) {
      throw new Error("Account balance must be zero");
    }

    const destAccount = state.getOrCreateAccount(destination);
    destAccount.lamports += tokenAccount.lamports;

    state.deleteAccount(account);
  } else {
    throw new Error(`Unknown token instruction: ${discriminator}`);
  }
}

// ATA Program
function executeATAProgram(
  instruction: TransactionInstruction,
  signers: Set<string>
) {
  if (instruction.keys.length < 6) throw new Error("Invalid ATA instruction");

  const payer = instruction.keys[0].pubkey;
  const ata = instruction.keys[1].pubkey;
  const owner = instruction.keys[2].pubkey;
  const mint = instruction.keys[3].pubkey;

  // Payer must be a signer
  if (!signers.has(payer.toBase58())) {
    throw new Error("Payer must be a signer");
  }

  // Derive ATA address
  const [derivedAta, bump] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  );

  if (!derivedAta.equals(ata)) {
    throw new Error("Invalid ATA address");
  }

  // Check if ATA already exists
  const existingAta = state.getAccount(ata);
  if (existingAta && (existingAta.lamports > 0 || existingAta.data.length > 0)) {
    throw new Error("ATA already exists");
  }

  // Calculate rent
  const rentExempt = (165 + 128) * 2;

  // Debit payer
  const payerAccount = state.getOrCreateAccount(payer);
  if (payerAccount.lamports < rentExempt) {
    throw new Error("Insufficient funds for rent");
  }
  payerAccount.lamports -= rentExempt;

  // Create ATA
  const ataAccount: Account = {
    lamports: rentExempt,
    owner: TOKEN_PROGRAM_ID,
    data: Buffer.alloc(165),
    executable: false,
    rentEpoch: 0,
  };

  // Initialize token account data
  mint.toBuffer().copy(ataAccount.data, 0);
  owner.toBuffer().copy(ataAccount.data, 32);
  writeU64LE(ataAccount.data, 0n, 64); // amount = 0
  // delegate option (36 bytes) - set to None (0)
  writeU32LE(ataAccount.data, 0, 72);
  ataAccount.data[108] = 1; // state = initialized
  // isNative option (12 bytes) - set to None (0)
  writeU32LE(ataAccount.data, 0, 109);
  // delegatedAmount (8 bytes) - set to 0
  writeU64LE(ataAccount.data, 0n, 121);
  // closeAuthority option (36 bytes) - set to None (0)
  writeU32LE(ataAccount.data, 0, 129);

  state.setAccount(ata, ataAccount);
}

// Transaction processing
function verifyAndExecuteTransaction(txBuffer: Buffer) {
  const tx = Transaction.from(txBuffer);

  // Verify blockhash
  const blockhash = tx.recentBlockhash;
  if (!blockhash || !state.blockhashes.has(blockhash)) {
    throw new Error("Invalid blockhash");
  }

  // Get signers
  const signers = new Set<string>();
  const message = tx.serializeMessage();

  // Verify signatures
  if (!tx.signatures || tx.signatures.length === 0) {
    throw new Error("No signatures");
  }

  for (let i = 0; i < tx.signatures.length; i++) {
    const signature = tx.signatures[i];
    if (!signature || !signature.publicKey) {
      throw new Error("Missing signature");
    }
    
    const pubkey = signature.publicKey;
    const sigBytes = signature.signature;

    // Check for missing or all-zero signature
    if (!sigBytes || sigBytes.length === 0 || sigBytes.every((b) => b === 0)) {
      throw new Error("Missing signature");
    }

    if (!nacl.sign.detached.verify(message, sigBytes, pubkey.toBytes())) {
      throw new Error("Invalid signature");
    }

    signers.add(pubkey.toBase58());
  }

  // Execute instructions
  for (const instruction of tx.instructions) {
    const programId = instruction.programId.toBase58();

    if (programId === SYSTEM_PROGRAM_ID.toBase58()) {
      executeSystemProgram(instruction, signers);
    } else if (programId === TOKEN_PROGRAM_ID.toBase58()) {
      executeTokenProgram(instruction, signers);
    } else if (programId === ATA_PROGRAM_ID.toBase58()) {
      executeATAProgram(instruction, signers);
    } else {
      throw new Error(`Unknown program: ${programId}`);
    }
  }

  // Increment slot
  state.slot++;
  state.blockHeight++;

  // Return first signature
  return bs58.encode(tx.signatures[0].signature!);
}

// RPC handlers
app.post("/", (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (!jsonrpc || !method) {
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid request" },
    });
  }

  try {
    let result: any;

    switch (method) {
      case "getVersion":
        result = { "solana-core": "1.18.0", "feature-set": 1 };
        break;

      case "getSlot":
        result = state.slot;
        break;

      case "getBlockHeight":
        result = state.blockHeight;
        break;

      case "getHealth":
        result = "ok";
        break;

      case "getLatestBlockhash": {
        const randomBytes = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
          randomBytes[i] = Math.floor(Math.random() * 256);
        }
        const blockhash = bs58.encode(randomBytes);
        state.blockhashes.add(blockhash);
        result = {
          context: { slot: state.slot },
          value: {
            blockhash,
            lastValidBlockHeight: state.blockHeight + 150,
          },
        };
        break;
      }

      case "getBalance": {
        if (!params || params.length < 1) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params" },
          });
        }
        const pubkey = new PublicKey(params[0]);
        const account = state.getAccount(pubkey);
        result = {
          context: { slot: state.slot },
          value: account ? account.lamports : 0,
        };
        break;
      }

      case "getAccountInfo": {
        if (!params || params.length < 1) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params" },
          });
        }
        const pubkey = new PublicKey(params[0]);
        const account = state.getAccount(pubkey);
        result = {
          context: { slot: state.slot },
          value: account
            ? {
                data: [account.data.toString("base64"), "base64"],
                executable: account.executable,
                lamports: account.lamports,
                owner: account.owner.toBase58(),
                rentEpoch: account.rentEpoch,
              }
            : null,
        };
        break;
      }

      case "getMinimumBalanceForRentExemption": {
        if (!params || params.length < 1) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params" },
          });
        }
        const dataSize = params[0];
        result = (dataSize + 128) * 2;
        break;
      }

      case "getTokenAccountBalance": {
        if (!params || params.length < 1) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params" },
          });
        }
        const pubkey = new PublicKey(params[0]);
        const account = state.getAccount(pubkey);
        if (!account || account.data.length !== 165) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid token account" },
          });
        }
        const amount = readU64LE(account.data, 64);
        const mint = new PublicKey(account.data.slice(0, 32));
        const mintAccount = state.getAccount(mint);
        const decimals = mintAccount && mintAccount.data.length === 82 ? mintAccount.data[44] : 0;
        const uiAmount = Number(amount) / Math.pow(10, decimals);
        result = {
          context: { slot: state.slot },
          value: {
            amount: amount.toString(),
            decimals,
            uiAmount,
          },
        };
        break;
      }

      case "getTokenAccountsByOwner": {
        if (!params || params.length < 2) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params" },
          });
        }
        const owner = new PublicKey(params[0]);
        const filter = params[1];
        const accounts: any[] = [];

        for (const [pubkeyStr, account] of state.accounts) {
          if (account.data.length !== 165) continue;

          const accountOwner = new PublicKey(account.data.slice(32, 64));
          if (!accountOwner.equals(owner)) continue;

          if (filter.mint) {
            const mint = new PublicKey(account.data.slice(0, 32));
            if (!mint.equals(new PublicKey(filter.mint))) continue;
          } else if (filter.programId) {
            if (!account.owner.equals(new PublicKey(filter.programId))) continue;
          }

          accounts.push({
            pubkey: pubkeyStr,
            account: {
              data: [account.data.toString("base64"), "base64"],
              executable: account.executable,
              lamports: account.lamports,
              owner: account.owner.toBase58(),
              rentEpoch: account.rentEpoch,
            },
          });
        }

        result = {
          context: { slot: state.slot },
          value: accounts,
        };
        break;
      }

      case "requestAirdrop": {
        if (!params || params.length < 2) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params" },
          });
        }
        const pubkey = new PublicKey(params[0]);
        const lamports = params[1];
        const account = state.getOrCreateAccount(pubkey);
        account.lamports += lamports;
        const sigBytes = Buffer.alloc(64);
        for (let i = 0; i < 64; i++) {
          sigBytes[i] = Math.floor(Math.random() * 256);
        }
        const signature = bs58.encode(sigBytes);
        state.signatures.set(signature, { slot: state.slot, err: null });
        result = signature;
        break;
      }

      case "sendTransaction": {
        if (!params || params.length < 1) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params" },
          });
        }
        try {
          const txBuffer = Buffer.from(params[0], "base64");
          const signature = verifyAndExecuteTransaction(txBuffer);
          state.signatures.set(signature, { slot: state.slot - 1, err: null });
          result = signature;
        } catch (err: any) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32003, message: err.message },
          });
        }
        break;
      }

      case "getSignatureStatuses": {
        if (!params || params.length < 1 || !Array.isArray(params[0])) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params" },
          });
        }
        const signatures = params[0];
        const statuses = signatures.map((sig: string) => {
          const status = state.signatures.get(sig);
          return status
            ? {
                slot: status.slot,
                confirmations: null,
                err: status.err,
                confirmationStatus: "confirmed",
              }
            : null;
        });
        result = {
          context: { slot: state.slot },
          value: statuses,
        };
        break;
      }

      default:
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        });
    }

    res.json({ jsonrpc: "2.0", id, result });
  } catch (err: any) {
    res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: err.message },
    });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Mini Solana Validator running on port ${PORT}`);
});
