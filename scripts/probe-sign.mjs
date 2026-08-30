// Round-trip probe: magic-prefixed message signing with recoverable sigs,
// noble v2 conventions (prehash: false — we hash with Bitcoin's magicHash).
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

const enc = new TextEncoder();

// Bitcoin varint (messages < 0xfd handled; larger use 0xfd + uint16le)
function varint(n) {
  if (n < 0xfd) return Uint8Array.from([n]);
  if (n <= 0xffff) return Uint8Array.from([0xfd, n & 0xff, n >> 8]);
  throw new Error("message too long");
}

function magicHash(message, magic = "Interchained Signed Message:\n") {
  const m = enc.encode(magic);
  const msg = enc.encode(message);
  const buf = new Uint8Array([...varint(m.length), ...m, ...varint(msg.length), ...msg]);
  return sha256(sha256(buf));
}

const priv = new Uint8Array(32).fill(7);
const pub = secp256k1.getPublicKey(priv, true);
const h = magicHash("NEDB Links auth challenge: chal_x nonce: abc123");

const sig = secp256k1.sign(h, priv, { format: "recovered", prehash: false });
console.log("recovered sig len:", sig.length, "| recid byte[0]:", sig[0]);

const rec = secp256k1.recoverPublicKey(sig, h, { format: "recovered", prehash: false });
console.log("recovered pubkey matches:", Buffer.from(rec).equals(Buffer.from(pub)));

// Compact 64B + recid header packing (BIP137-style: header 39-42 for P2WPKH)
const compact = sig.slice(1);
const header = 39 + sig[0];
const packed = Uint8Array.from([header, ...compact]);
const unpackedRecid = (packed[0] - 27) & 3;
const restored = Uint8Array.from([unpackedRecid, ...packed.slice(1)]);
const rec2 = secp256k1.recoverPublicKey(restored, h, { format: "recovered", prehash: false });
console.log("BIP137 pack/unpack round trip:", Buffer.from(rec2).equals(Buffer.from(pub)));
