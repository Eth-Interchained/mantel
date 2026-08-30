// Empirical probe: prove the ITC wallet stack against the PUBLISHED BIP84
// test vector before any auth code builds on it.
import * as bip39 from "@scure/bip39";
import { BIP32Factory } from "bip32";
import * as ecc from "@bitcoinerlab/secp256k1";
import { payments } from "interchainedjs-lib";

// The interchained network — verified against itcd chainparams.cpp (+ message.cpp)
const interchained = {
  messagePrefix: "Interchained Signed Message:\n",
  bech32: "itc",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
};
const bitcoinNet = { ...interchained, bech32: "bc", messagePrefix: "Bitcoin Signed Message:\n" };

// Standard BIP84 test vector mnemonic
const mn =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const seed = await bip39.mnemonicToSeed(mn);
const bip32 = BIP32Factory(ecc);
const child = bip32.fromSeed(seed).derivePath("m/84'/0'/0'/0/0");

const btc = payments.p2wpkh({ pubkey: child.publicKey, network: bitcoinNet });
const itc = payments.p2wpkh({ pubkey: child.publicKey, network: interchained });
console.log("btc address:", btc.address);
console.log("BIP84 vector:", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
console.log(
  "MATCHES PUBLISHED VECTOR:",
  btc.address === "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
);
console.log("itc address:", itc.address);
