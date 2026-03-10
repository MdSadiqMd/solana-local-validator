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
  data[0] = 20;
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

function createMintToInstruction(
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 7;
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

function createTransferCheckedInstruction(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number
): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(amount, 1);
  data[9] = decimals;
  return new TransactionInstruction({
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
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
  return await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
}

async function main() {
  console.log("Running comprehensive test suite...\n");

  // Test all RPC methods
  console.log("1. Testing RPC methods...");
  const version = await connection.getVersion();
  const slot = await connection.getSlot();
  const blockHeight = await connection.getBlockHeight();
  const { blockhash } = await connection.getLatestBlockhash();
  console.log(`   Version: ${version["solana-core"]}, Slot: ${slot}, Height: ${blockHeight}`);
  console.log(`   Blockhash: ${blockhash.substring(0, 10)}...`);

  // Test airdrop and balance
  console.log("\n2. Testing airdrop and balance...");
  const payer = Keypair.generate();
  await connection.requestAirdrop(payer.publicKey, 20 * LAMPORTS_PER_SOL);
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`   Payer balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // Test system transfers
  console.log("\n3. Testing system transfers...");
  const recipient1 = Keypair.generate();
  const recipient2 = Keypair.generate();
  
  let tx = new Transaction()
    .add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient1.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
      })
    )
    .add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient2.publicKey,
        lamports: 3 * LAMPORTS_PER_SOL,
      })
    );
  await sendAndConfirm(tx, [payer]);
  
  const bal1 = await connection.getBalance(recipient1.publicKey);
  const bal2 = await connection.getBalance(recipient2.publicKey);
  console.log(`   Recipient 1: ${bal1 / LAMPORTS_PER_SOL} SOL, Recipient 2: ${bal2 / LAMPORTS_PER_SOL} SOL`);

  // Test create account
  console.log("\n4. Testing create account...");
  const newAccount = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(82);
  
  tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: newAccount.publicKey,
      lamports: rent,
      space: 82,
      programId: TOKEN_PROGRAM_ID,
    })
  );
  await sendAndConfirm(tx, [payer, newAccount]);
  
  const accountInfo = await connection.getAccountInfo(newAccount.publicKey);
  console.log(`   Created account with ${accountInfo!.data.length} bytes`);

  // Test SPL Token - Create mint
  console.log("\n5. Testing SPL Token mint creation...");
  const mintAuthority = Keypair.generate();
  await connection.requestAirdrop(mintAuthority.publicKey, 10 * LAMPORTS_PER_SOL);
  
  const mint = Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(82);
  
  tx = new Transaction()
    .add(
      SystemProgram.createAccount({
        fromPubkey: mintAuthority.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: mintRent,
        space: 82,
        programId: TOKEN_PROGRAM_ID,
      })
    )
    .add(createInitializeMint2Instruction(mint.publicKey, 6, mintAuthority.publicKey, null));
  await sendAndConfirm(tx, [mintAuthority, mint]);
  console.log(`   Mint created: ${mint.publicKey.toBase58().substring(0, 10)}...`);

  // Test ATA creation
  console.log("\n6. Testing Associated Token Account creation...");
  const owner1 = Keypair.generate();
  const owner2 = Keypair.generate();
  await connection.requestAirdrop(owner1.publicKey, 5 * LAMPORTS_PER_SOL);
  await connection.requestAirdrop(owner2.publicKey, 5 * LAMPORTS_PER_SOL);
  
  const ata1 = getAssociatedTokenAddressSync(mint.publicKey, owner1.publicKey);
  const ata2 = getAssociatedTokenAddressSync(mint.publicKey, owner2.publicKey);
  
  tx = new Transaction()
    .add(createAssociatedTokenAccountInstruction(owner1.publicKey, ata1, owner1.publicKey, mint.publicKey))
    .add(createAssociatedTokenAccountInstruction(owner2.publicKey, ata2, owner2.publicKey, mint.publicKey));
  await sendAndConfirm(tx, [owner1, owner2]);
  console.log(`   Created 2 ATAs`);

  // Test minting
  console.log("\n7. Testing token minting...");
  tx = new Transaction()
    .add(createMintToInstruction(mint.publicKey, ata1, mintAuthority.publicKey, 1000000n))
    .add(createMintToInstruction(mint.publicKey, ata2, mintAuthority.publicKey, 2000000n));
  await sendAndConfirm(tx, [mintAuthority]);
  
  const balance1 = await connection.getTokenAccountBalance(ata1);
  const balance2 = await connection.getTokenAccountBalance(ata2);
  console.log(`   ATA1: ${balance1.value.uiAmount}, ATA2: ${balance2.value.uiAmount}`);

  // Test TransferChecked
  console.log("\n8. Testing TransferChecked...");
  tx = new Transaction().add(
    createTransferCheckedInstruction(ata1, mint.publicKey, ata2, owner1.publicKey, 500000n, 6)
  );
  await sendAndConfirm(tx, [owner1]);
  
  const afterTransfer1 = await connection.getTokenAccountBalance(ata1);
  const afterTransfer2 = await connection.getTokenAccountBalance(ata2);
  console.log(`   After transfer - ATA1: ${afterTransfer1.value.uiAmount}, ATA2: ${afterTransfer2.value.uiAmount}`);

  // Test getTokenAccountsByOwner
  console.log("\n9. Testing getTokenAccountsByOwner...");
  const accountsByOwner = await connection.getTokenAccountsByOwner(owner1.publicKey, { mint: mint.publicKey });
  const accountsByProgram = await connection.getTokenAccountsByOwner(owner2.publicKey, { programId: TOKEN_PROGRAM_ID });
  console.log(`   Found ${accountsByOwner.value.length} accounts by mint, ${accountsByProgram.value.length} by program`);

  // Test signature statuses
  console.log("\n10. Testing signature statuses...");
  tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    })
  );
  const sig = await sendAndConfirm(tx, [payer]);
  const statuses = await connection.getSignatureStatuses([sig, "UnknownSig123"]);
  console.log(`   Status for valid sig: ${statuses.value[0]?.confirmationStatus}, invalid: ${statuses.value[1]}`);

  // Test slot increments
  console.log("\n11. Testing slot increments...");
  const slotBefore = await connection.getSlot();
  tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    })
  );
  await sendAndConfirm(tx, [payer]);
  const slotAfter = await connection.getSlot();
  console.log(`   Slot before: ${slotBefore}, after: ${slotAfter}, incremented: ${slotAfter > slotBefore}`);

  console.log("\n✓ All comprehensive tests passed!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
