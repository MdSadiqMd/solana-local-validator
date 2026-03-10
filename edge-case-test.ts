import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const connection = new Connection("http://localhost:3000", {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  confirmTransactionInitialTimeout: 5000,
});

async function testError(name: string, fn: () => Promise<void>, expectedError: string) {
  try {
    await fn();
    console.error(`✗ ${name} - should have thrown error`);
    process.exit(1);
  } catch (err: any) {
    if (err.message.toLowerCase().includes(expectedError.toLowerCase())) {
      console.log(`✓ ${name}`);
    } else {
      console.error(`✗ ${name} - wrong error: ${err.message}`);
      process.exit(1);
    }
  }
}

async function main() {
  console.log("Testing edge cases...\n");

  const payer = Keypair.generate();
  await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);

  // Test 1: Invalid blockhash
  await testError(
    "Reject invalid blockhash",
    async () => {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );
      // Use a valid base58 string that was never issued by getLatestBlockhash
      tx.recentBlockhash = "11111111111111111111111111111111";
      tx.feePayer = payer.publicKey;
      tx.sign(payer);
      await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    },
    "blockhash"
  );

  // Test 2: Invalid signature
  await testError(
    "Reject invalid signature",
    async () => {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      // Sign with wrong keypair
      tx.sign(Keypair.generate());
      await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    },
    "signer"
  );

  // Test 3: Insufficient funds
  await testError(
    "Reject insufficient funds",
    async () => {
      const poorAccount = Keypair.generate();
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: poorAccount.publicKey,
          toPubkey: payer.publicKey,
          lamports: 100 * LAMPORTS_PER_SOL,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = poorAccount.publicKey;
      tx.sign(poorAccount);
      await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    },
    "insufficient"
  );

  // Test 4: CreateAccount - account already exists
  await testError(
    "Reject CreateAccount for existing account",
    async () => {
      const existing = Keypair.generate();
      await connection.requestAirdrop(existing.publicKey, LAMPORTS_PER_SOL);
      
      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: existing.publicKey,
          lamports: 1000000,
          space: 100,
          programId: SystemProgram.programId,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer, existing);
      await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    },
    "already exists"
  );

  // Test 5: CreateAccount - new account must be signer
  await testError(
    "Reject CreateAccount without new account signature",
    async () => {
      const newAccount = Keypair.generate();
      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: newAccount.publicKey,
          lamports: 1000000,
          space: 100,
          programId: SystemProgram.programId,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      // Only sign with payer, not new account
      tx.sign(payer);
      await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    },
    "signature"
  );

  // Test 6: Transfer without signer
  await testError(
    "Reject Transfer without from signer",
    async () => {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      // Sign with wrong keypair
      tx.sign(Keypair.generate());
      await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    },
    "signer"
  );

  // Test 7: getTokenAccountBalance on non-token account
  await testError(
    "Reject getTokenAccountBalance on non-token account",
    async () => {
      await connection.getTokenAccountBalance(payer.publicKey);
    },
    "token"
  );

  // Test 8: getSignatureStatuses for unknown signature
  console.log("Testing getSignatureStatuses for unknown signature...");
  const statuses = await connection.getSignatureStatuses(["UnknownSignature123"]);
  if (statuses.value[0] !== null) {
    console.error("✗ Should return null for unknown signature");
    process.exit(1);
  }
  console.log("✓ getSignatureStatuses returns null for unknown signature");

  // Test 9: Slot increments
  console.log("Testing slot increments...");
  const slotBefore = await connection.getSlot();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    })
  );
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const slotAfter = await connection.getSlot();
  if (slotAfter <= slotBefore) {
    console.error("✗ Slot should increment");
    process.exit(1);
  }
  console.log("✓ Slot increments after transaction");

  // Test 10: getSignatureStatuses for processed transaction
  console.log("Testing getSignatureStatuses for processed transaction...");
  const tx2 = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    })
  );
  const { blockhash: blockhash2 } = await connection.getLatestBlockhash();
  tx2.recentBlockhash = blockhash2;
  tx2.feePayer = payer.publicKey;
  tx2.sign(payer);
  const sig = await connection.sendRawTransaction(tx2.serialize(), { skipPreflight: true });
  
  const statuses2 = await connection.getSignatureStatuses([sig]);
  if (!statuses2.value[0] || statuses2.value[0].confirmationStatus !== "confirmed") {
    console.error("✗ Invalid signature status");
    process.exit(1);
  }
  console.log("✓ getSignatureStatuses returns correct status");

  console.log("\n✓ All edge case tests passed!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
