import { useState } from "react";
import { canonicalize } from "./canonicalize";
import { computeFileHash } from "./hashing";
import { generateAndStoreKeypair, getPrivateKey } from "./keypair";
import { signBlock } from "./signing";
import { importPublicKey, verifyBlock } from "./verify";

export default function CryptoTest() {
  const [log, setLog] = useState([]);

  function print(label, passed, detail = "") {
    setLog((prev) => [
      ...prev,
      { label, passed, detail },
    ]);
  }

  async function runAllTests() {
    setLog([]); // clear previous run

    // ---- Step 1: canonicalize ----
    try {
      const meta = {
        transferId: "abc",
        fileName: "x.png",
        fileSize: 100,
        mimeType: "image/png",
        timestamp: "2026-07-07",
        senderId: "u1",
        sessionId: "s1",
        previousHash: null,
      };
      const result = canonicalize(meta);
      const expectedOrder = '{"fileName":"x.png","fileSize":100,"mimeType":"image/png","previousHash":null,"senderId":"u1","sessionId":"s1","timestamp":"2026-07-07","transferId":"abc"}';
      print("Step 1: canonicalize", result === expectedOrder, result);
    } catch (e) {
      print("Step 1: canonicalize", false, e.message);
    }

    // ---- Step 2: hashing ----
    let fileHash;
    try {
      const dummyFile = new TextEncoder().encode("hello world").buffer;
      const meta = {
        transferId: "t1",
        fileName: "test.txt",
        fileSize: 11,
        mimeType: "text/plain",
        timestamp: "2026-07-07T10:00:00Z",
        senderId: "test-user",
        sessionId: "s1",
        previousHash: null,
      };
      const h1 = await computeFileHash(dummyFile, meta);
      const h2 = await computeFileHash(dummyFile, meta);
      const h3 = await computeFileHash(dummyFile, { ...meta, fileName: "different.txt" });
      fileHash = h1;
      print(
        "Step 2: hashing (deterministic + sensitive)",
        h1 === h2 && h1 !== h3,
        `h1=${h1.slice(0, 12)}... h3=${h3.slice(0, 12)}...`
      );
    } catch (e) {
      print("Step 2: hashing", false, e.message);
    }

    // ---- Step 3: keypair ----
    let privateKey, publicKeyBase64;
    try {
      const generated = await generateAndStoreKeypair("test-user");
      privateKey = generated.privateKey;
      publicKeyBase64 = generated.publicKeyBase64;

      const retrieved = await getPrivateKey("test-user");
      print(
        "Step 3: keypair gen + IndexedDB retrieval",
        retrieved !== null && retrieved.type === "private",
        `publicKey (first 20 chars): ${publicKeyBase64.slice(0, 20)}...`
      );
    } catch (e) {
      print("Step 3: keypair", false, e.message);
    }

    // ---- Step 4: signing ----
    let signature;
    try {
      const meta = {
        transferId: "t1",
        fileName: "test.txt",
        fileSize: 11,
        mimeType: "text/plain",
        timestamp: "2026-07-07T10:00:00Z",
        senderId: "test-user",
        sessionId: "s1",
        previousHash: null,
      };
      signature = await signBlock(fileHash, meta, privateKey);
      print("Step 4: signing (runs without error)", !!signature, `sig (first 20 chars): ${signature.slice(0, 20)}...`);
    } catch (e) {
      print("Step 4: signing", false, e.message);
    }

    // ---- Step 5: verify (round trip) ----
    try {
      const meta = {
        transferId: "t1",
        fileName: "test.txt",
        fileSize: 11,
        mimeType: "text/plain",
        timestamp: "2026-07-07T10:00:00Z",
        senderId: "test-user",
        sessionId: "s1",
        previousHash: null,
      };
      const publicKey = await importPublicKey(publicKeyBase64);

      const goodResult = await verifyBlock(signature, fileHash, meta, publicKey);
      const tamperedMeta = { ...meta, fileName: "tampered.txt" };
      const badResult = await verifyBlock(signature, fileHash, tamperedMeta, publicKey);

      print(
        "Step 5a: verify accepts valid signature",
        goodResult.valid === true,
        JSON.stringify(goodResult)
      );
      print(
        "Step 5b: verify rejects tampered metadata",
        badResult.valid === false && badResult.reason === "invalid-signature",
        JSON.stringify(badResult)
      );
    } catch (e) {
      print("Step 5: verify", false, e.message);
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "monospace" }}>
      <button onClick={runAllTests} style={{ padding: "8px 16px", fontSize: 16 }}>
        Run Crypto Test
      </button>
      <div style={{ marginTop: 16 }}>
        {log.map((entry, i) => (
          <div key={i} style={{ color: entry.passed ? "green" : "red", marginBottom: 6 }}>
            {entry.passed ? "✅ PASS" : "❌ FAIL"} — {entry.label}
            {entry.detail && (
              <div style={{ color: "#666", fontSize: 12, marginLeft: 20 }}>
                {entry.detail}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}