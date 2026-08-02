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
    const [otherUserIdInput, setOtherUserIdInput] = useState("");

    const provisionUser = async () => {
        setLog([]);
        const userId = currentUserIdInput; // see note below
        try {
            const ecdsa = await generateAndStoreKeypair(userId);
            await registerPublicKey(userId, ecdsa.publicKeyBase64, "ECDSA-P256");
            print(`userId: ${userId}`);
            print(`ECDSA public key: ${ecdsa.publicKeyBase64.slice(0, 50)}...`);
            print("✅ ECDSA key generated and registered");

            const ecdh = await generateAndStoreECDHKeypair(userId);
            print(`ECDH public key: ${ecdh.publicKeyBase64.slice(0, 60)}...`);
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

    const checkKeyPairing = async (userId) => {
        setLog([]);
        try {
            const priv = await getPrivateKey(userId, "ECDH-P256");
            if (!priv) {
                print("❌ No local private key found for this user in this browser");
                return;
            }
            const privJwk = await crypto.subtle.exportKey("jwk", priv);
            print(`Local private key's public coords: x=${privJwk.x.slice(0, 20)}... y=${privJwk.y.slice(0, 20)}...`);

            const res = await fetch(`http://localhost:8082/api/keys/${userId}/ECDH-P256`);
            const { publicKey } = await res.json();
            const pub = await importECDHPublicKey(publicKey);
            const pubJwk = await crypto.subtle.exportKey("jwk", pub);
            print(`Backend-registered public key coords: x=${pubJwk.x.slice(0, 20)}... y=${pubJwk.y.slice(0, 20)}...`);

            print(privJwk.x === pubJwk.x && privJwk.y === pubJwk.y
                ? "✅ MATCH — local private key pairs with registered public key"
                : "❌ MISMATCH — local private key does NOT match what's registered on backend");
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

    const checkRealUsersDerive = async () => {
        setLog([]);
        const userA = "500e61d7-169a-4995-ba58-2fdc0383f11a";
        const userB = "c9299f38-1f53-45f0-a50c-1cf3291fbba3";
        try {
            const privA = await getPrivateKey(userA, "ECDH-P256");
            if (!privA) { print(`❌ No local private key for ${userA} in THIS browser`); return; }

            const pubBBase64 = await fetchECDHPublicKey(userB);
            const pubB = await importECDHPublicKey(pubBBase64);

            const shared = await crypto.subtle.deriveKey(
                { name: "ECDH", public: pubB },
                privA,
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"]
            );
            const raw = await crypto.subtle.exportKey("raw", shared);
            const hex = Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, "0")).join("");
            print(`Derived as ${userA} with ${userB}'s key: ${hex}`);
        } catch (err) {
            print(`❌ FAILED: ${err.message}`);
        }
    };

    const checkSharedSecret = async (myUserId, otherUserId) => {
        setLog([]);
        console.log("USING PATCHED VERSION")
        try {
            const myPrivate = await getPrivateKey(myUserId, "ECDH-P256");
            const publicKey = await fetchECDHPublicKey(otherUserId); // CHANGED — was a raw fetch, now uses the no-store-patched function
            const otherPublic = await importECDHPublicKey(publicKey);

            const sharedKeyDebug = await crypto.subtle.deriveKey(
                { name: "ECDH", public: otherPublic },
                myPrivate,
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"]
            );
            const raw = await crypto.subtle.exportKey("raw", sharedKeyDebug);
            const hex = Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, "0")).join("");
            print(`Shared secret (as ${myUserId} deriving with ${otherUserId}): ${hex}`);
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
                        placeholder="my user ID"
                        value={currentUserIdInput}
                        onChange={(e) => setCurrentUserIdInput(e.target.value)}
                        style={{ width: 320 }}
                    />
                    <input
                        type="text"
                        placeholder="other user's ID"
                        value={otherUserIdInput}
                        onChange={(e) => setOtherUserIdInput(e.target.value)}
                        style={{ width: 320 }}
                    />
                    <button onClick={provisionUser}>Provision this users keys</button>
                    <button onClick={() => checkKeyPairing(currentUserIdInput)}>Check key pairing</button>
                    <button onClick={() => checkSharedSecret(currentUserIdInput, otherUserIdInput)}>Check shared secret</button>
                    <button onClick={checkRealUsersDerive}>Check real users derive (same browser)</button>
                </div>
            </div>
        </div>
    );
}