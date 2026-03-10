import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";

const connection = new Connection("http://localhost:3000", {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  confirmTransactionInitialTimeout: 5000,
});

async function main() {
  console.log("Testing basic RPC methods...\n");

  // Test getVersion
  console.log("1. Testing getVersion...");
  const version = await connection.getVersion();
  console.log("✓ Version:", version);

  // Test getSlot
  console.log("\n2. Testing getSlot...");
  const slot = await connection.getSlot();
  console.log("✓ Slot:", slot);

  // Test getLatestBlockhash
  console.log("\n3. Testing getLatestBlockhash...");
  const { blockhash } = await connection.getLatestBlockhash();
  console.log("✓ Blockhash:", blockhash);

  // Test requestAirdrop
  console.log("\n4. Testing requestAirdrop...");
  const payer = Keypair.generate();
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
  console.log("✓ Airdrop signature:", airdropSig);

  // Test getBalance
  console.log("\n5. Testing getBalance...");
  const balance = await connection.getBalance(payer.publicKey);
  console.log("✓ Balance:", balance, "lamports");

  // Test System Transfer
  console.log("\n6. Testing System Transfer...");
  const recipient = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: LAMPORTS_PER_SOL,
    })
  );
  
  const { blockhash: recentBlockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = recentBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  
  const rawTx = tx.serialize();
  const sig = await connection.sendRawTransaction(rawTx, { skipPreflight: true });
  console.log("✓ Transfer signature:", sig);

  // Verify transfer
  const recipientBalance = await connection.getBalance(recipient.publicKey);
  console.log("✓ Recipient balance:", recipientBalance, "lamports");

  console.log("\n✓ All basic tests passed!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
