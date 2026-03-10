import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

const connection = new Connection("http://localhost:3000", {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  confirmTransactionInitialTimeout: 5000,
});

function createInitializeMint2Instruction(
  mint: PublicKey,
  decimals: number,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null
): TransactionInstruction {
  const data = Buffer.alloc(67);
  data[0] = 20; // InitializeMint2 discriminator
  data[1] = decimals;
  mintAuthority.toBuffer().copy(data, 2);
  if (freezeAuthority) {
    data[34] = 1;
    freezeAuthority.toBuffer().copy(data, 35);
  } else {
    data[34] = 0;
  }

  return new TransactionInstruction({
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

function createInitializeAccount3Instruction(
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(33);
  data[0] = 18; // InitializeAccount3 discriminator
  owner.toBuffer().copy(data, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

function createMintToInstruction(
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 7; // MintTo discriminator
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

function createTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 3; // Transfer discriminator
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

function createBurnInstruction(
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 8; // Burn discriminator
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

function createCloseAccountInstruction(
  account: PublicKey,
  destination: PublicKey,
  owner: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(1);
  data[0] = 9; // CloseAccount discriminator

  return new TransactionInstruction({
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.alloc(0),
  });
}

async function sendAndConfirm(tx: Transaction, signers: Keypair[]): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  return sig;
}

async function main() {
  console.log("Testing SPL Token Program...\n");

  // Setup
  const payer = Keypair.generate();
  await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
  console.log("✓ Airdrop to payer");

  const mintAuthority = Keypair.generate();
  await connection.requestAirdrop(mintAuthority.publicKey, 5 * LAMPORTS_PER_SOL);
  console.log("✓ Airdrop to mint authority");

  // Create mint account
  const mint = Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(82);
  
  let tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: mintRent,
      space: 82,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, 9, mintAuthority.publicKey, null)
  );
  await sendAndConfirm(tx, [payer, mint]);
  console.log("✓ Created and initialized mint");

  // Create token account using ATA
  const owner = Keypair.generate();
  await connection.requestAirdrop(owner.publicKey, 5 * LAMPORTS_PER_SOL);
  
  const ata = getAssociatedTokenAddressSync(mint.publicKey, owner.publicKey);
  
  tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(owner.publicKey, ata, owner.publicKey, mint.publicKey)
  );
  await sendAndConfirm(tx, [owner]);
  console.log("✓ Created associated token account");

  // Verify ATA was created
  const ataInfo = await connection.getAccountInfo(ata);
  if (!ataInfo || ataInfo.data.length !== 165) {
    throw new Error("ATA not created properly");
  }
  console.log("✓ Verified ATA account");

  // Mint tokens
  tx = new Transaction().add(
    createMintToInstruction(mint.publicKey, ata, mintAuthority.publicKey, 1000000000n)
  );
  await sendAndConfirm(tx, [mintAuthority]);
  console.log("✓ Minted tokens");

  // Check token balance
  const balance = await connection.getTokenAccountBalance(ata);
  if (balance.value.amount !== "1000000000") {
    throw new Error(`Expected 1000000000, got ${balance.value.amount}`);
  }
  console.log("✓ Verified token balance:", balance.value.amount);

  // Create second token account for transfer
  const recipient = Keypair.generate();
  await connection.requestAirdrop(recipient.publicKey, 5 * LAMPORTS_PER_SOL);
  
  const recipientAta = getAssociatedTokenAddressSync(mint.publicKey, recipient.publicKey);
  
  tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(recipient.publicKey, recipientAta, recipient.publicKey, mint.publicKey)
  );
  await sendAndConfirm(tx, [recipient]);
  console.log("✓ Created recipient token account");

  // Transfer tokens
  tx = new Transaction().add(
    createTransferInstruction(ata, recipientAta, owner.publicKey, 500000000n)
  );
  await sendAndConfirm(tx, [owner]);
  console.log("✓ Transferred tokens");

  // Verify balances
  const ownerBalance = await connection.getTokenAccountBalance(ata);
  const recipientBalance = await connection.getTokenAccountBalance(recipientAta);
  
  if (ownerBalance.value.amount !== "500000000") {
    throw new Error(`Expected owner balance 500000000, got ${ownerBalance.value.amount}`);
  }
  if (recipientBalance.value.amount !== "500000000") {
    throw new Error(`Expected recipient balance 500000000, got ${recipientBalance.value.amount}`);
  }
  console.log("✓ Verified transfer balances");

  // Burn tokens
  tx = new Transaction().add(
    createBurnInstruction(ata, mint.publicKey, owner.publicKey, 100000000n)
  );
  await sendAndConfirm(tx, [owner]);
  console.log("✓ Burned tokens");

  // Verify burn
  const afterBurn = await connection.getTokenAccountBalance(ata);
  if (afterBurn.value.amount !== "400000000") {
    throw new Error(`Expected 400000000 after burn, got ${afterBurn.value.amount}`);
  }
  console.log("✓ Verified burn");

  // Burn remaining tokens
  tx = new Transaction().add(
    createBurnInstruction(ata, mint.publicKey, owner.publicKey, 400000000n)
  );
  await sendAndConfirm(tx, [owner]);
  console.log("✓ Burned remaining tokens");

  // Close account
  tx = new Transaction().add(
    createCloseAccountInstruction(ata, owner.publicKey, owner.publicKey)
  );
  await sendAndConfirm(tx, [owner]);
  console.log("✓ Closed token account");

  // Verify account is closed
  const closedAccount = await connection.getAccountInfo(ata);
  if (closedAccount !== null) {
    throw new Error("Account should be closed");
  }
  console.log("✓ Verified account closed");

  // Test getTokenAccountsByOwner
  const accounts = await connection.getTokenAccountsByOwner(recipient.publicKey, { mint: mint.publicKey });
  if (accounts.value.length !== 1) {
    throw new Error(`Expected 1 token account, got ${accounts.value.length}`);
  }
  console.log("✓ getTokenAccountsByOwner works");

  console.log("\n✓ All SPL Token tests passed!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
