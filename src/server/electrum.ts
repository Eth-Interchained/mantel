/**
 * Minimal ElectrumX client — one job: confirmed ITC balance of an
 * itc1 address, against the Interchained fleet (seed.interchained.org;
 * rx.interchained.org is deprecated and deliberately absent).
 *
 * Protocol: newline-delimited JSON-RPC over TLS. Address → scripthash
 * per the Electrum convention: sha256(scriptPubKey), reversed hex.
 * For P2WPKH the scriptPubKey is OP_0 PUSH20 <hash160> (0x0014…).
 *
 * Failure posture: holder checks FAIL CLOSED for the unlock (can't
 * verify → not verified) but never break claims — the fiat door and
 * the free tier keep working when the fleet is unreachable.
 */

import * as net from "node:net";
import * as tls from "node:tls";

import { sha256 } from "@noble/hashes/sha2.js";
import { address as itcAddress } from "interchainedjs-lib";

import { bytesToHex } from "../lib/wallet";
import { config } from "./config";

/** Electrum scripthash for a P2WPKH itc1 address. */
export function addressToScripthash(addr: string): string {
  const decoded = itcAddress.fromBech32(addr);
  if (decoded.prefix !== "itc" || decoded.version !== 0 || decoded.data.length !== 20) {
    throw new Error("only itc1 P2WPKH addresses are supported");
  }
  const script = new Uint8Array(22);
  script[0] = 0x00; // OP_0
  script[1] = 0x14; // push 20
  script.set(decoded.data, 2);
  return bytesToHex(sha256(script).slice().reverse());
}

interface ElectrumBalance {
  confirmed: number;
  unconfirmed: number;
}

/** One-shot JSON-RPC call over a fresh socket. */
function electrumCall(
  method: string,
  params: unknown[],
  timeoutMs = 8000,
): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const socket: net.Socket = config.electrumTls
      ? tls.connect({
          host: config.electrumHost,
          port: config.electrumPort,
          rejectUnauthorized: false, // fleet certs are self-managed
        })
      : net.connect({ host: config.electrumHost, port: config.electrumPort });

    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`electrum timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      fn();
    };

    socket.on("error", (err) => finish(() => reject(err)));
    socket.on(config.electrumTls ? "secureConnect" : "connect", () => {
      socket.write(
        JSON.stringify({ id: 1, method, params }) + "\n",
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      try {
        const msg = JSON.parse(buffer.slice(0, nl)) as {
          result?: unknown;
          error?: { message?: string };
        };
        if (msg.error) {
          finish(() => reject(new Error(msg.error?.message ?? "electrum error")));
        } else {
          finish(() => resolvePromise(msg.result));
        }
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error("bad electrum response")));
      }
    });
  });
}

// Short cache so claim bursts don't hammer the fleet.
const cache = new Map<string, { itc: number; at: number }>();
const CACHE_TTL_MS = 120_000;

/** Confirmed balance in whole ITC, or null when the check can't be made. */
export async function confirmedItcBalance(addr: string): Promise<number | null> {
  const hit = cache.get(addr);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.itc;
  try {
    const scripthash = addressToScripthash(addr);
    const result = (await electrumCall("blockchain.scripthash.get_balance", [
      scripthash,
    ])) as ElectrumBalance;
    const itc = (result?.confirmed ?? 0) / 1e8;
    cache.set(addr, { itc, at: Date.now() });
    return itc;
  } catch (err) {
    console.warn(
      `[links] electrum balance check failed for ${addr.slice(0, 14)}…: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

/** Does this address hold the unlimited threshold? Fail-closed. */
export async function isItcHolder(addr: string): Promise<boolean> {
  const itc = await confirmedItcBalance(addr);
  return itc !== null && itc >= config.itcThreshold;
}
