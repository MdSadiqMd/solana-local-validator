import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  burn,
  closeAccount,
  getAccount,
} from "@solana/spl-token";

const connection = new Connection("http://localhost:3000", "confirmed");

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err: any) {
    console.error(`✗ ${name}`);
    console.error(err.message);
    process.exit(1);
  }
}

async function main() {
  console.log("Running tests...\n");

  // Test 1: Basic RPC methods
  await test("getVersion", async () => {
    const version = await connection.getVersion();
    if (!version["solana-core"]) throw new Error("Missing solana-core");
  });

  await test("getHealth", async () => {
    const health = await (connection as any)._rpcRequest("getHealth", []);
    if (health.result !== "ok") throw new Error("Health check failed");
  });

  await test("getSlot", async () => {
    const slot = await connection.getSlot();
    if (typeof slot !== "number") throw new Error("Invalid slot");
  });

  await test("getBlockHeight", async () => {
    const height = await connection.getBlockHeight();
    if (typeof height !== "number") throw new Error("Invalid block height");
  });

  // Test 2: Blockhash
  await test("getLatestBlockhash", async () => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    if (!blockhash || typeof lastValidBlockHeight !== "number") {
      throw new Error("Invalid blockhash response");
    }
  });

  // Test 3: Account queries
  const payer = Keypair.generate();
  
  await test("requestAirdrop", async () => {
    const sig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
    if (!sig) throw new Error("No signature returned");
  });

  await test("getBalance", async () => {
    const balance = await connection.getBalance(payer.publicKey);
    if (balance !== 10 * LAMPORTS_PER_SOL) {
      throw new Error(`Expected ${10 * LAMPORTS_PER_SOL}, got ${balance}`);
    }
  });

  await test("getBalance for non-existent account", async () => {
    const balance = await connection.getBalance(Keypair.generate().publicKey);
    if (balance !== 0) throw new Error("Should return 0 for non-existent account");
  });

  await test("getAccountInfo", async () => {
    const info = await connection.getAccountInfo(payer.publicKey);
    if (!info || info.lamports !== 10 * LAMPORTS_PER_SOL) {
      throw new Error("Invalid account info");
    }
  });

  await test("getAccountInfo for non-existent account", async () => {
    const info = await connection.getAccountInfo(Keypair.generate().publicKey);
    if (info !== null) throw new Error("Should return null for non-existent account");
  });

  await test("getMinimumBalanceForRentExemption", async () => {
    const rent = await connection.getMinimumBalanceForRentExemption(165);
    if (typeof rent !== "number" || rent <= 0) {
      throw new Error("Invalid rent exemption");
    }
  });

  // Test 4: System Program - Transfer
  const recipient = Keypair.generate();
  
  await test("System Transfer", async () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL,
      })
    );
    await sendAndConfirmTransaction(connection, tx, [payer]);
    
    const balance = await connection.getBalance(recipient.publicKey);
    if (balance !== LAMPORTS_PER_SOL) {
      throw new Error(`Expected ${LAMPORTS_PER_SOL}, got ${balance}`);
    }
  });

  await test("System Transfer - insufficient funds", async () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: recipient.publicKey,
        toPubkey: payer.publicKey,
        lamports: 100 * LAMPORTS_PER_SOL,
      })
    );
    try {
      await sendAndConfirmTransaction(connection, tx, [recipient]);
      throw new Error("Should have failed");
    } catch (err: any) {
      if (!err.message.includes("insufficient")) {
        throw new Error("Wrong error message");
      }
    }
  });

  // Test 5: System Program - CreateAccount
  const newAccount = Keypair.generate();
  
  await test("System CreateAccount", async () => {
    const space = 165;
    const rent = await connection.getMinimumBalanceForRentExemption(space);
    
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: newAccount.publicKey,
        lamports: rent,
        space,
        programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      })
    );
    await sendAndConfirmTransaction(connection, tx, [payer, newAccount]);
    
    const info = await connection.getAccountInfo(newAccount.publicKey);
    if (!info || info.data.length !== space) {
      throw new Error("Account not created properly");
    }
  });

  // Test 6: SPL Token - Create Mint
  const mintAuthority = Keypair.generate();
  await connection.requestAirdrop(mintAuthority.publicKey, 5 * LAMPORTS_PER_SOL);
  
  let mint: PublicKey;
  await test("Create Mint", async () => {
    mint = await createMint(
      connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9
    );
    
    const info = await connection.getAccountInfo(mint);
    if (!info || info.data.length !== 82) {
      throw new Error("Mint not created properly");
    }
  });

  // Test 7: SPL Token - Create Token Account (ATA)
  const tokenOwner = Keypair.generate();
  await connection.requestAirdrop(tokenOwner.publicKey, 5 * LAMPORTS_PER_SOL);
  
  let tokenAccount: any;
  await test("Create Associated Token Account", async () => {
    tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tokenOwner,
      mint,
      tokenOwner.publicKey
    );
    
    if (!tokenAccount.address) {
      throw new Error("Token account not created");
    }
  });

  // Test 8: SPL Token - MintTo
  await test("MintTo", async () => {
    await mintTo(
      connection,
      mintAuthority,
      mint,
      tokenAccount.address,
      mintAuthority,
      1000000000
    );
    
    const account = await getAccount(connection, tokenAccount.address);
    if (account.amount !== 1000000000n) {
      throw new Error(`Expected 1000000000, got ${account.amount}`);
    }
  });

  await test("getTokenAccountBalance", async () => {
    const balance = await connection.getTokenAccountBalance(tokenAccount.address);
    if (balance.value.amount !== "1000000000") {
      throw new Error(`Expected 1000000000, got ${balance.value.amount}`);
    }
  });

  // Test 9: SPL Token - Transfer
  const recipient2 = Keypair.generate();
  await connection.requestAirdrop(recipient2.publicKey, 5 * LAMPORTS_PER_SOL);
  
  let recipientTokenAccount: any;
  await test("Token Transfer", async () => {
    recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      recipient2,
      mint,
      recipient2.publicKey
    );
    
    await transfer(
      connection,
      tokenOwner,
      tokenAccount.address,
      recipientTokenAccount.address,
      tokenOwner,
      500000000
    );
    
    const account = await getAccount(connection, recipientTokenAccount.address);
    if (account.amount !== 500000000n) {
      throw new Error(`Expected 500000000, got ${account.amount}`);
    }
  });

  await test("getTokenAccountsByOwner", async () => {
    const accounts = await connection.getTokenAccountsByOwner(
      tokenOwner.publicKey,
      { mint }
    );
    
    if (accounts.value.length !== 1) {
      throw new Error(`Expected 1 account, got ${accounts.value.length}`);
    }
  });

  // Test 10: SPL Token - Burn
  await test("Burn tokens", async () => {
    await burn(
      connection,
      tokenOwner,
      tokenAccount.address,
      mint,
      tokenOwner,
      100000000
    );
    
    const account = await getAccount(connection, tokenAccount.address);
    if (account.amount !== 400000000n) {
      throw new Error(`Expected 400000000, got ${account.amount}`);
    }
  });

  // Test 11: SPL Token - Close Account
  await test("Close token account", async () => {
    // Burn remaining tokens first
    await burn(
      connection,
      tokenOwner,
      tokenAccount.address,
      mint,
      tokenOwner,
      400000000
    );
    
    const balanceBefore = await connection.getBalance(tokenOwner.publicKey);
    
    await closeAccount(
      connection,
      tokenOwner,
      tokenAccount.address,
      tokenOwner.publicKey,
      tokenOwner
    );
    
    const info = await connection.getAccountInfo(tokenAccount.address);
    if (info !== null) {
      throw new Error("Account should be closed");
    }
    
    const balanceAfter = await connection.getBalance(tokenOwner.publicKey);
    if (balanceAfter <= balanceBefore) {
      throw new Error("Lamports not returned");
    }
  });

  // Test 12: Invalid blockhash
  await test("Reject invalid blockhash", async () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1000,
      })
    );
    tx.recentBlockhash = "InvalidBlockhash123456789";
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    
    try {
      await connection.sendRawTransaction(tx.serialize());
      throw new Error("Should have rejected invalid blockhash");
    } catch (err: any) {
      if (!err.message.includes("blockhash")) {
        throw new Error("Wrong error for invalid blockhash");
      }
    }
  });

  // Test 13: Signature verification
  await test("Reject invalid signature", async () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1000,
      })
    );
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    
    // Sign with wrong keypair
    tx.sign(Keypair.generate());
    
    try {
      await connection.sendRawTransaction(tx.serialize());
      throw new Error("Should have rejected invalid signature");
    } catch (err: any) {
      if (!err.message.includes("signature")) {
        throw new Error("Wrong error for invalid signature");
      }
    }
  });

  // Test 14: getSignatureStatuses
  await test("getSignatureStatuses", async () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1000,
      })
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    
    const statuses = await connection.getSignatureStatuses([sig]);
    if (!statuses.value[0] || statuses.value[0].confirmationStatus !== "confirmed") {
      throw new Error("Invalid signature status");
    }
  });

  await test("getSignatureStatuses - unknown signature", async () => {
    const statuses = await connection.getSignatureStatuses(["UnknownSignature123"]);
    if (statuses.value[0] !== null) {
      throw new Error("Should return null for unknown signature");
    }
  });

  // Test 15: Slot increments
  await test("Slot increments after transaction", async () => {
    const slotBefore = await connection.getSlot();
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1000,
      })
    );
    await sendAndConfirmTransaction(connection, tx, [payer]);
    
    const slotAfter = await connection.getSlot();
    if (slotAfter <= slotBefore) {
      throw new Error("Slot should increment after transaction");
    }
  });

  console.log("\n✓ All tests passed!");
}

main().catch(console.error);
