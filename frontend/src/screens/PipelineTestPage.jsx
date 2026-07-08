import { useState } from "react";
import CryptoTest from "../crypto/CryptoTest";
import { canonicalize } from "../crypto/canonicalize";
import { computeFileHash } from "../crypto/hashing";
import { generateAndStoreKeypair } from "../crypto/keypair";
import { signBlock } from "../crypto/signing";
import { importPublicKey, verifyBlock } from "../crypto/verify";
import {
  embedProvenanceBlock,
  buildHeader,
} from "../pipeline/chainEmbed";
import {
  parseHeader,
  unwrapPayload,
  reconstructChain,
  createChainStore,
} from "../pipeline/chainReconstruct";
import { concatBuffers } from "../crypto/canonicalize"; // re-exported helper

const API_BASE_URL = import.meta.env.VITE_PIPELINE_API_URL;

// Shared log renderer, same shape/style as Anisa's CryptoTest so the
// three sections on this page read consistently.
function ResultLog({ log }) {
  return (
    <div style={{ marginTop: 12 }}>
      {log.map((entry, i) => (
        <div key={i} style={{ color: entry.passed ? "green" : "red", marginBottom: 6 }}>
          {entry.passed ? "✅ PASS" : "❌ FAIL"} — {entry.label}
          {entry.detail && (
            <div style={{ color: "#666", fontSize: 12, marginLeft: 20, whiteSpace: "pre-wrap" }}>
              {entry.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: 8,
        padding: 16,
        marginBottom: 24,
        fontFamily: "monospace",
      }}
    >
      <h2 style={{ fontSize: 16, marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------
// Section 2: Suchi's chain embed/reconstruct tests (client-side only,
// no backend needed — mirrors the node:test file 1:1)
// ---------------------------------------------------------------
function ChainTests() {
  const [log, setLog] = useState([]);

  function print(label, passed, detail = "") {
    setLog((prev) => [...prev, { label, passed, detail }]);
  }

  function runAllTests() {
    setLog([]);

    // Test 1: round trip
    try {
      const metadata = {
        transferId: "11111111-1111-1111-1111-111111111111",
        sessionId: "22222222-2222-2222-2222-222222222222",
        senderId: "33333333-3333-3333-3333-333333333333",
        fileName: "test.txt",
        fileSize: 5,
        mimeType: "text/plain",
        timestamp: "2026-07-07T00:00:00.000Z",
        previousHash: null,
      };
      const fileHash = "deadbeef".repeat(8);
      const signature = "c2lnbmF0dXJl";
      const fileBuffer = new TextEncoder().encode("hello").buffer;

      const wrapped = embedProvenanceBlock(fileBuffer, metadata, fileHash, signature);
      const { signedBlock, fileBytes } = parseHeader(wrapped);

      const ok =
        JSON.stringify(signedBlock.metadata) === JSON.stringify(metadata) &&
        signedBlock.fileHash === fileHash &&
        signedBlock.signature === signature &&
        new TextDecoder().decode(fileBytes) === "hello";

      print("Embed → unwrap round trip preserves signedBlock + file bytes", ok);
    } catch (e) {
      print("Embed → unwrap round trip", false, e.message);
    }

    // Test 2: bad magic bytes
    try {
      const bogus = new ArrayBuffer(20);
      let threw = false;
      try {
        parseHeader(bogus);
      } catch (e) {
        threw = /bad magic bytes/.test(e.message);
      }
      print("parseHeader rejects bad magic bytes", threw);
    } catch (e) {
      print("parseHeader rejects bad magic bytes", false, e.message);
    }

    // Test 3: truncated buffer
    try {
      const tooShort = new ArrayBuffer(4);
      let threw = false;
      try {
        parseHeader(tooShort);
      } catch (e) {
        threw = /shorter than header/.test(e.message);
      }
      print("parseHeader rejects truncated buffers", threw);
    } catch (e) {
      print("parseHeader rejects truncated buffers", false, e.message);
    }

    // Test 4: declared length overruns buffer
    try {
      const header = buildHeader(9999);
      const buf = concatBuffers(header, new ArrayBuffer(5));
      let threw = false;
      try {
        parseHeader(buf);
      } catch (e) {
        threw = /exceeds buffer size/.test(e.message);
      }
      print("parseHeader rejects a declared length that overruns the buffer", threw);
    } catch (e) {
      print("parseHeader rejects overrun length", false, e.message);
    }

    // Test 5: chain gap detection
    try {
      const store = createChainStore();
      const block = { fileHash: "abc123", metadata: { previousHash: "does-not-exist" } };
      const result = reconstructChain(block, store);
      print(
        "reconstructChain flags a gap as broken, not a fresh start",
        result.chainBroken === true && result.priorBlock === null,
        JSON.stringify(result)
      );
    } catch (e) {
      print("reconstructChain gap detection", false, e.message);
    }

    // Test 6: chain linking
    try {
      const store = createChainStore();
      const first = { fileHash: "hash-a", metadata: { previousHash: null } };
      reconstructChain(first, store);
      const second = { fileHash: "hash-b", metadata: { previousHash: "hash-a" } };
      const result = reconstructChain(second, store);
      print(
        "reconstructChain links a block to its resolvable prior block",
        result.chainBroken === false && result.priorBlock === first
      );
    } catch (e) {
      print("reconstructChain linking", false, e.message);
    }
  }

  return (
    <Section title="Suchi — chain embed / reconstruct (client-side, no backend)">
      <button onClick={runAllTests} style={{ padding: "8px 16px", fontSize: 14 }}>
        Run Chain Tests
      </button>
      <ResultLog log={log} />
    </Section>
  );
}

// ---------------------------------------------------------------
// Section 3: full pipeline integration — Fariha's live endpoints +
// Anisa's crypto + Suchi's embed/unwrap, chained end to end.
// ---------------------------------------------------------------
function IntegrationTest() {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);

  function print(label, passed, detail = "") {
    setLog((prev) => [...prev, { label, passed, detail }]);
  }

  async function runIntegration() {
    setLog([]);
    setRunning(true);
    const sessionId = "6fcf3caa-a69f-4d65-bd8d-e40a6496ded2";
    const senderId = crypto.randomUUID();
    const fileText = "Integration test file for the provenance pipeline.";
    const fileBuffer = new TextEncoder().encode(fileText).buffer;

    try {
      // 1. keypair + registration
      const { privateKey, publicKeyBase64 } = await generateAndStoreKeypair(senderId);
      const regRes = await fetch(`${API_BASE_URL}/api/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: senderId, publicKey: publicKeyBase64, algorithm: "ECDSA-P256" }),
      });
      print("Register public key (Fariha 3.2)", regRes.ok, `status ${regRes.status}`);
      if (!regRes.ok) throw new Error("Key registration failed");

      // 2. request metadata block
      const metaRes = await fetch(`${API_BASE_URL}/api/transfer/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          senderId,
          fileName: "integration-test.txt",
          fileSize: fileBuffer.byteLength,
          mimeType: "text/plain",
        }),
      });
      if (!metaRes.ok) throw new Error(`Metadata request failed: ${metaRes.status}`);
      const metadata = await metaRes.json();
      print(
        "Request unsigned metadata block (Fariha 3.1)",
        metadata.previousHash === null,
        JSON.stringify(metadata)
      );

      // 3. hash + sign (Anisa)
      const fileHash = await computeFileHash(fileBuffer, metadata);
      print("Compute file hash (Anisa 2.1)", !!fileHash, fileHash);

      const signature = await signBlock(fileHash, metadata, privateKey);
      print("Sign block (Anisa 2.3)", !!signature, signature.slice(0, 24) + "…");

      // 4. PATCH backend
      const patchRes = await fetch(`${API_BASE_URL}/api/transfer/metadata/${metadata.transferId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileHash, signature }),
      });
      print("PATCH hash + signature back (Fariha 3.1 Task 3)", patchRes.ok, `status ${patchRes.status}`);
      if (!patchRes.ok) throw new Error("PATCH failed");

      // 5. embed (Suchi)
      const wrapped = embedProvenanceBlock(fileBuffer, metadata, fileHash, signature);
      print("Embed provenance block (Suchi 4.1)", wrapped.byteLength > 0, `${wrapped.byteLength} bytes`);

      // 6. unwrap (Suchi) — simulates receiver
      const { signedBlock, fileBytes } = unwrapPayload(wrapped);
      const roundTripOk = new TextDecoder().decode(fileBytes) === fileText;
      print("Unwrap payload, file bytes unchanged (Suchi 4.2)", roundTripOk);
      if (!roundTripOk) throw new Error("File bytes did not round-trip");

      // 7. receiver fetches sender's public key
      const keyRes = await fetch(`${API_BASE_URL}/api/keys/${senderId}`);
      if (!keyRes.ok) throw new Error(`Public key lookup failed: ${keyRes.status}`);
      const { publicKey: fetchedKeyB64 } = await keyRes.json();
      print("Receiver fetches sender's public key (Fariha 3.2)", !!fetchedKeyB64);

      // 8. verify signature (Anisa)
      const pubKey = await importPublicKey(fetchedKeyB64);
      const verifyResult = await verifyBlock(signedBlock.signature, signedBlock.fileHash, signedBlock.metadata, pubKey);
      print("Verify signature (Anisa 2.4)", verifyResult.valid === true, JSON.stringify(verifyResult));

      // 9. recompute hash cross-check
      const recomputed = await computeFileHash(fileBytes, signedBlock.metadata);
      print(
        "Cross-check recomputed hash matches signed hash",
        recomputed === signedBlock.fileHash,
        `signed=${signedBlock.fileHash.slice(0, 12)}… recomputed=${recomputed.slice(0, 12)}…`
      );

      // 10. chain reconstruction (Suchi) — first transfer, previousHash null
      const store = createChainStore();
      const chainResult = reconstructChain(signedBlock, store);
      print(
        "Chain reconstruction — first transfer, no gap flagged (Suchi 4.2)",
        chainResult.chainBroken === false,
        JSON.stringify(chainResult)
      );
    } catch (e) {
      print("Pipeline halted", false, e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section title="Full pipeline — Anisa + Fariha (live) + Suchi, chained end to end">
      {!API_BASE_URL && (
        <div style={{ color: "orange", marginBottom: 10 }}>
          VITE_API_BASE_URL isn't set — this section needs it to reach Fariha's backend.
        </div>
      )}
      <button
        onClick={runIntegration}
        disabled={running || !API_BASE_URL}
        style={{ padding: "8px 16px", fontSize: 14 }}
      >
        {running ? "Running…" : "Run Full Pipeline"}
      </button>
      <ResultLog log={log} />
    </Section>
  );
}

export default function PipelineTestPage() {
  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "monospace", fontSize: 20 }}>Provenance Pipeline — Test Page</h1>
      <p style={{ color: "#888", fontFamily: "monospace", fontSize: 13, marginBottom: 24 }}>
        Three independent sections: Anisa's crypto unit tests, Suchi's chain
        embed/reconstruct unit tests, and a live integration run that chains
        all three people's code together against the real backend.
      </p>

      <Section title="Anisa — crypto unit tests (canonicalize, hash, keypair, sign, verify)">
        <CryptoTest />
      </Section>

      <ChainTests />
      <IntegrationTest />
    </div>
  );
}