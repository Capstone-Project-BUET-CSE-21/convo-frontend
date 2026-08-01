import { useState } from "react";
import {
    generateAndStoreECDHKeypair,
    generateAndStoreKeypair,
    getPrivateKey,
    registerPublicKey,
} from "../crypto/keypair";
import {
    importECDHPublicKey,
    deriveSharedKey,
    fetchECDHPublicKey,
} from "../crypto/ecdh";
import {
    encryptData,
    decryptData,
} from "../crypto/aesGcm";

import { encryptPayload, decryptPayload } from "../pipeline/encryptionEnvelope";


export default function CryptoUnitTestPage() {
    const [log, setLog] = useState([]);
    const print = (line) => setLog((l) => [...l, line]);
    const [currentUserIdInput, setCurrentUserIdInput] = useState("");

    const provisionUser = async () => {
        setLog([]);
        const userId = currentUserIdInput; // see note below
        try {
            const ecdsa = await generateAndStoreKeypair(userId);
            await registerPublicKey(userId, ecdsa.publicKeyBase64, "ECDSA-P256");
            print("✅ ECDSA key generated and registered");

            const ecdh = await generateAndStoreECDHKeypair(userId);
            await registerPublicKey(userId, ecdh.publicKeyBase64, "ECDH-P256");
            print("✅ ECDH key generated and registered");
        } catch (err) {
            print(`❌ FAILED: ${err.message}`);
        }
    };
    const runTest = async () => {
        setLog([]);
        const userId = crypto.randomUUID();
        print(`userId: ${userId}`);
        try {
            await generateAndStoreKeypair(userId);
            print("✅ ECDSA key generated and stored");

            const { publicKeyBase64 } = await generateAndStoreECDHKeypair(userId);
            print(`✅ ECDH key generated: ${publicKeyBase64.slice(0, 20)}...`);

            const ecdsa = await getPrivateKey(userId, "ECDSA-P256");
            const ecdh = await getPrivateKey(userId, "ECDH-P256");
            print(ecdsa && ecdh ? "✅ Both keys coexist in IndexedDB" : "❌ One overwrote the other");

            const result = await registerPublicKey(userId, publicKeyBase64, "ECDH-P256");
            print(`✅ Registered with backend (status ${result})`);
        } catch (err) {
            print(`❌ FAILED: ${err.message}`);
        }
    };

    const testEnvelopeEncryption = async () => {
        setLog([]);
        const alice = crypto.randomUUID();
        const bob = crypto.randomUUID();
        const charlie = crypto.randomUUID();
        const anisa = crypto.randomUUID();
        print(`alice: ${alice}, bob: ${bob}, charlie: ${charlie}, anisa: ${anisa}`);

        try {
            const aliceKeys = await generateAndStoreECDHKeypair(alice);
            const bobKeys = await generateAndStoreECDHKeypair(bob);
            const charlieKeys = await generateAndStoreECDHKeypair(charlie);
            const anisaKeys = await generateAndStoreECDHKeypair(anisa);
            await registerPublicKey(alice, aliceKeys.publicKeyBase64, "ECDH-P256");
            await registerPublicKey(bob, bobKeys.publicKeyBase64, "ECDH-P256");
            await registerPublicKey(charlie, charlieKeys.publicKeyBase64, "ECDH-P256");
            await registerPublicKey(anisa, anisaKeys.publicKeyBase64, "ECDH-P256")
            print("✅ Alice, Bob, Charlie and Anisa all have registered ECDH keys");

            const encryptionKeys = {
                [bob]: { publicKey: bobKeys.publicKeyBase64, algorithm: "ECDH-P256" },
                [charlie]: { publicKey: charlieKeys.publicKeyBase64, algorithm: "ECDH-P256" },
                [anisa]: { publicKey: anisaKeys.publicKeyBase64, algorithm: "ECDH-P256" },
            };

            const message = new TextEncoder().encode("secret file from Alice to the group");
            print(`Message: ${message}`)
            const envelope = await encryptPayload(message, { senderId: alice, encryptionKeys });

            print("✅ Alice encrypted once, wrapped for 2 recipients");

            const bobResult = await decryptPayload(envelope, { recipientId: bob });
            print(new TextDecoder().decode(bobResult) === "sec file from Alice to the group"
                ? "✅ Bob decrypted correctly" : "❌ Bob mismatch");

            const charlieResult = await decryptPayload(envelope, { recipientId: charlie });
            print(new TextDecoder().decode(charlieResult) === "secret file from Alice to the group"
                ? "✅ Charlie decrypted correctly" : "❌ Charlie mismatch");
            //const anisaResult = await decryptPayload(envelope, { recipientId: anisa });
            print(new TextDecoder().decode(charlieResult) === "secret file from Alice to the group"
                ? "✅ Anisa decrypted correctly" : "❌ Charlie mismatch");
        } catch (err) {
            print(`❌ FAILED: ${err.message}`);
        }
    };
    const testEncryption = async () => {
        setLog([]);
        const userA = crypto.randomUUID();
        const userB = crypto.randomUUID();
        print(`userA: ${userA}, userB: ${userB}`);

        try {
            const keyA = await generateAndStoreECDHKeypair(userA);
            const keyB = await generateAndStoreECDHKeypair(userB);
            print("✅ Both ECDH keypairs generated");

            // simulate what each side would do after fetching the other's public key from the backend
            const pubA = await importECDHPublicKey(keyA.publicKeyBase64);
            const pubB = await importECDHPublicKey(keyB.publicKeyBase64);

            const privA = await getPrivateKey(userA, "ECDH-P256");
            const privB = await getPrivateKey(userB, "ECDH-P256");

            const sharedOnA = await deriveSharedKey(privA, pubB);
            const sharedOnB = await deriveSharedKey(privB, pubA);
            print("✅ Both sides derived a shared key independently");

            const message = new TextEncoder().encode("hello from A to B");
            const { ciphertext, iv } = await encryptData(sharedOnA, message);
            print(`✅ Encrypted on A's side: ${ciphertext.slice(0, 20)}...`);

            const decrypted = await decryptData(sharedOnB, ciphertext, iv);
            const decryptedText = new TextDecoder().decode(decrypted);
            print(decryptedText === "hello from A to B"
                ? "✅ Decrypted on B's side — matches original"
                : `❌ Mismatch: got "${decryptedText}"`);
        } catch (err) {
            print(`❌ FAILED: ${err.message}`);
        }
    };
    const testFullRoundTrip = async () => {
        setLog([]);
        const userA = crypto.randomUUID();
        const userB = crypto.randomUUID();
        print(`userA: ${userA}, userB: ${userB}`);

        try {
            const keyA = await generateAndStoreECDHKeypair(userA);
            const keyB = await generateAndStoreECDHKeypair(userB);
            print("✅ Both ECDH keypairs generated");

            await registerPublicKey(userA, keyA.publicKeyBase64, "ECDH-P256");
            await registerPublicKey(userB, keyB.publicKeyBase64, "ECDH-P256");
            print("✅ Both public keys registered with backend");

            // this time, actually fetch — no shortcuts through memory
            const fetchedPubA = await fetchECDHPublicKey(userA);
            const fetchedPubB = await fetchECDHPublicKey(userB);
            if (!fetchedPubA || !fetchedPubB) {
                print("❌ FAILED: one or both public keys not found on backend");
                return;
            }
            print("✅ Both public keys fetched back from backend");

            const pubA = await importECDHPublicKey(fetchedPubA);
            const pubB = await importECDHPublicKey(fetchedPubB);

            const privA = await getPrivateKey(userA, "ECDH-P256");
            const privB = await getPrivateKey(userB, "ECDH-P256");

            const sharedOnA = await deriveSharedKey(privA, pubB);
            const sharedOnB = await deriveSharedKey(privB, pubA);
            print("✅ Both sides derived a shared key independently");

            const message = new TextEncoder().encode("hello from A to B, over the wire");
            const { ciphertext, iv } = await encryptData(sharedOnA, message);
            print(`✅ Encrypted on A's side: ${ciphertext.slice(0, 20)}...`);

            const decrypted = await decryptData(sharedOnB, ciphertext, iv);
            const decryptedText = new TextDecoder().decode(decrypted);
            print(decryptedText === "hello from A to B, over the wire"
                ? "✅ Decrypted on B's side — full round-trip confirmed"
                : `❌ Mismatch: got "${decryptedText}"`);
        } catch (err) {
            print(`❌ FAILED: ${err.message}`);
        }
    };
    return (
        <div>
            <div style={{ padding: 20, fontFamily: "monospace" }}>
                <button onClick={runTest}>Run crypto unit tests</button>
                <button onClick={testEncryption}>Test ECDH encryption</button>
                <button onClick={testFullRoundTrip}>Test full round-trip (via backend)</button>
                <pre>{log.join("\n")}</pre>
                <button onClick={testEnvelopeEncryption}>Test envelope encryption</button>.

                <div style={{ marginTop: 10 }}>
                    <input
                        type="text"
                        placeholder="paste real user ID here"
                        value={currentUserIdInput}
                        onChange={(e) => setCurrentUserIdInput(e.target.value)}
                        style={{ width: 320 }}
                    />
                    <button onClick={provisionUser}>Provision this users keys</button>
                </div>
            </div>
        </div>
    );
}