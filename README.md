# Mini Solana Validator

A complete in-memory, single-node Solana-compatible JSON-RPC server implementation.

## Features

### Implemented RPC Methods
- ✅ `getVersion` - Returns Solana version info
- ✅ `getSlot` - Returns current slot (increments with each transaction)
- ✅ `getBlockHeight` - Returns current block height
- ✅ `getHealth` - Returns "ok"
- ✅ `getLatestBlockhash` - Generates and tracks blockhashes
- ✅ `getBalance` - Returns account balance in lamports
- ✅ `getAccountInfo` - Returns full account information
- ✅ `getMinimumBalanceForRentExemption` - Calculates rent exemption
- ✅ `getTokenAccountBalance` - Returns token account balance
- ✅ `getTokenAccountsByOwner` - Queries token accounts by owner/mint/program
- ✅ `requestAirdrop` - Credits accounts with SOL
- ✅ `sendTransaction` - Processes and executes transactions
- ✅ `getSignatureStatuses` - Returns transaction confirmation status

### Implemented Programs

#### System Program (`11111111111111111111111111111111`)
- ✅ CreateAccount (discriminator 0) - Creates new accounts with space allocation
- ✅ Transfer (discriminator 2) - Transfers SOL between accounts

#### SPL Token Program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)
- ✅ InitializeMint2 (discriminator 20) - Initializes token mints
- ✅ InitializeAccount3 (discriminator 18) - Initializes token accounts
- ✅ MintTo (discriminator 7) - Mints tokens to accounts
- ✅ Transfer (discriminator 3) - Transfers tokens between accounts
- ✅ TransferChecked (discriminator 12) - Transfers with decimal verification
- ✅ Burn (discriminator 8) - Burns tokens from accounts
- ✅ CloseAccount (discriminator 9) - Closes token accounts and returns rent

#### Associated Token Account Program (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`)
- ✅ Create - Creates ATAs using PDA derivation

### Security Features
- ✅ Ed25519 signature verification for all transactions
- ✅ Blockhash validation (rejects unknown blockhashes)
- ✅ Signer verification for all instructions
- ✅ Balance checks for transfers
- ✅ Account existence validation
- ✅ Proper error codes (-32601, -32600, -32602, -32003)

## Installation

```bash
npm install
```

## Usage

Start the server:
```bash
npm start
```

The server will listen on port 3000.

## Testing

Run all tests:
```bash
./run-all-tests.sh
```

Or run individual test suites:
```bash
npm test                      # Original test suite
npx tsx simple-test.ts        # Basic RPC tests
npx tsx token-test.ts         # SPL Token tests
npx tsx edge-case-test.ts     # Edge case tests
npx tsx comprehensive-test.ts # Full integration tests
```

## Implementation Details

### Account Model
Every account has:
- `pubkey` - Public key (address)
- `lamports` - SOL balance in lamports
- `owner` - Program that owns the account
- `data` - Byte array (empty for SOL accounts, 82 bytes for mints, 165 bytes for token accounts)
- `executable` - Always false for user accounts
- `rentEpoch` - Rent epoch (always 0 in this implementation)

### Data Layouts

#### Mint Account (82 bytes)
```
[4 bytes mintAuthorityOption (u32 LE)]
[32 bytes mintAuthority]
[8 bytes supply (u64 LE)]
[1 byte decimals]
[1 byte isInitialized]
[4 bytes freezeAuthorityOption (u32 LE)]
[32 bytes freezeAuthority]
```

#### Token Account (165 bytes)
```
[32 bytes mint]
[32 bytes owner]
[8 bytes amount (u64 LE)]
[36 bytes delegate option]
[1 byte state]
[12 bytes isNative option]
[8 bytes delegatedAmount (u64 LE)]
[36 bytes closeAuthority option]
```

### Transaction Processing
1. Deserialize base64-encoded transaction
2. Verify blockhash was issued by server
3. Verify all ed25519 signatures
4. Execute instructions sequentially
5. Increment slot and block height
6. Return first signature

## Architecture

Single-file implementation (`src/index.ts`) with:
- Express HTTP server for JSON-RPC 2.0
- In-memory state management
- Full transaction deserialization and verification
- Complete program instruction execution

## Dependencies
- `express` - HTTP server
- `@solana/web3.js` - Transaction handling and PublicKey operations
- `@solana/spl-token` - Token program constants (testing only)
- `bs58` - Base58 encoding/decoding
- `tweetnacl` - Ed25519 signature verification

## Compatibility

This validator is compatible with standard Solana client libraries:
- `@solana/web3.js` - Full support
- `@solana/spl-token` - Full support for implemented instructions

You can point any Solana client to `http://localhost:3000` and interact with it as if it were a real Solana cluster.
