/*
 * Nolus mainnet transfer helper for Phantom / Solflare linked accounts.
 *
 * Connect a Solana wallet at https://app.nolus.io/, then paste this entire
 * script into the browser Console. A transfer panel opens on the page.
 *
 * No seed phrase or private key is requested. Signing the Amino JSON
 * authorizes a Nolus bank transfer. Tokens remain on Nolus.
 */

(async () => {
  "use strict";

  const cfg = {
    source: "",
    destination: "",
    wallet: "",
    tokenDenom: "",
    tokenSymbol: "",
    tokenDecimals: null,
    amount: "",
    amountMode: "",
  };

  // Solana-origin USDC held ON NOLUS, not USDC in the Solana wallet.
  const feeDenom =
    "ibc/3E507F7BA8D40C5CDFFB74234444ECEB6889562B82DE70E70F9EA8DE16B3D452";
  let feeDecimals = null;
  let assetCatalog = new Map();
  // This gas limit is for the first simulation only. The final value comes
  // from the current Nolus gas multiplier and simulated gas usage.
  const initialSimulationGas = 250000n;

  const chainId = "pirin-1";
  const memo = "Transfer tokens between my Nolus accounts";

  const endpoints = [
    "https://lcd.nolus.network",
    "https://nolus.api.liveraven.net",
    "https://nolus-api.cogwheel.zone",
    "https://nolus-api.polkachu.com",
  ];

  if (location.origin !== "https://app.nolus.io") {
    throw new Error("Run this script only at https://app.nolus.io/.");
  }

  if (window.nolusTransfer) {
    throw new Error("Refresh the page before loading another configuration.");
  }

  const utf8 = (s) => new TextEncoder().encode(s);

  const base64 = (b) => btoa(String.fromCharCode(...b));

  const unbase64 = (s) =>
    Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const hex = (b) =>
    Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

  const same = (a, b) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  const sha256 = async (b) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", b));

  const concat = (...parts) => {
    const out = new Uint8Array(
      parts.reduce((n, b) => n + b.length, 0)
    );

    let offset = 0;

    for (const b of parts) {
      out.set(b, offset);
      offset += b.length;
    }

    return out;
  };

  // Validate Bech32 checksum, Nolus prefix and 20-byte address payload.
  const decodeAddress = (address) => {
    if (
      typeof address !== "string" ||
      !/^nolus1[023456789acdefghjklmnpqrstuvwxyz]+$/.test(address)
    ) {
      throw new Error(
        "Enter a complete lowercase nolus1... wallet address."
      );
    }

    const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    const values = Array.from(
      address.slice(6),
      (c) => alphabet.indexOf(c)
    );

    const hrp = "nolus";
    const expanded = [
      ...Array.from(hrp, (c) => c.charCodeAt(0) >> 5),
      0,
      ...Array.from(hrp, (c) => c.charCodeAt(0) & 31),
      ...values,
    ];

    const generators = [
      0x3b6a57b2,
      0x26508e6d,
      0x1ea119fa,
      0x3d4233dd,
      0x2a1462b3,
    ];

    let checksum = 1;

    for (const value of expanded) {
      const top = checksum >>> 25;

      checksum = (
        ((checksum & 0x1ffffff) << 5) ^ value
      ) >>> 0;

      for (let i = 0; i < 5; i++) {
        if ((top >>> i) & 1) {
          checksum = (checksum ^ generators[i]) >>> 0;
        }
      }
    }

    if (checksum !== 1) {
      throw new Error("Invalid Nolus address checksum.");
    }

    const out = [];
    let accumulator = 0;
    let bits = 0;

    for (const value of values.slice(0, -6)) {
      accumulator = ((accumulator << 5) | value) & 0xffff;
      bits += 5;

      while (bits >= 8) {
        bits -= 8;
        out.push((accumulator >>> bits) & 255);
      }
    }

    if (
      bits >= 5 ||
      ((accumulator << (8 - bits)) & 255) !== 0 ||
      out.length !== 20
    ) {
      throw new Error(
        "Expected a canonical 20-byte Nolus wallet address."
      );
    }

    return Uint8Array.from(out);
  };

  const encodeAddress = (payload) => {
    if (payload.length !== 20) {
      throw new Error("Expected a 20-byte Nolus address payload.");
    }

    const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    const hrp = "nolus";
    const values = [];
    let accumulator = 0;
    let bits = 0;

    for (const byte of payload) {
      accumulator = (accumulator << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        bits -= 5;
        values.push((accumulator >>> bits) & 31);
      }

      accumulator &= (1 << bits) - 1;
    }

    if (bits) values.push((accumulator << (5 - bits)) & 31);

    const expanded = [
      ...Array.from(hrp, (c) => c.charCodeAt(0) >> 5),
      0,
      ...Array.from(hrp, (c) => c.charCodeAt(0) & 31),
      ...values,
      0, 0, 0, 0, 0, 0,
    ];
    const generators = [
      0x3b6a57b2, 0x26508e6d, 0x1ea119fa,
      0x3d4233dd, 0x2a1462b3,
    ];
    let checksum = 1;

    for (const value of expanded) {
      const top = checksum >>> 25;
      checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;

      for (let i = 0; i < 5; i++) {
        if ((top >>> i) & 1) checksum = (checksum ^ generators[i]) >>> 0;
      }
    }

    checksum = (checksum ^ 1) >>> 0;
    const result = hrp + "1" +
      [...values, ...Array.from({ length: 6 }, (_, i) =>
        (checksum >>> (5 * (5 - i))) & 31
      )].map((v) => alphabet[v]).join("");

    if (!same(decodeAddress(result), payload)) {
      throw new Error("Could not derive the linked Nolus address.");
    }

    return result;
  };

  // Exact arithmetic: monetary amounts never use floating-point numbers.
  const toUnits = (amount, decimals) => {
    if (
      typeof amount !== "string" ||
      !/^\d+(\.\d+)?$/.test(amount) ||
      amount.length > 100
    ) {
      throw new Error(
        'Use an ordinary positive decimal string, e.g. "0.154".'
      );
    }

    const [whole, fraction = ""] = amount.split(".");

    if (fraction.length > decimals) {
      throw new Error(
        "Amount exceeds the configured token precision."
      );
    }

    const units = BigInt(
      whole + fraction.padEnd(decimals, "0")
    );

    if (units <= 0n || units > (1n << 256n) - 1n) {
      throw new Error("Amount is outside the supported range.");
    }

    return units;
  };

  const formatUnits = (units, decimals) => {
    const value = BigInt(units)
      .toString()
      .padStart(decimals + 1, "0");

    if (decimals === 0) return value;

    const fraction = value
      .slice(-decimals)
      .replace(/0+$/, "");

    return (
      value.slice(0, -decimals) +
      (fraction ? "." + fraction : "")
    );
  };

  // Canonical Amino JSON: recursively sort object keys.
  const sorted = (value) => {
    if (Array.isArray(value)) return value.map(sorted);

    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, sorted(value[k])])
      );
    }

    return value;
  };

  // Minimal Protobuf encoding for this single bank transfer.
  const varint = (n) => {
    n = BigInt(n);

    if (n < 0n || n > 18446744073709551615n) {
      throw new Error("Invalid uint64.");
    }

    const out = [];

    do {
      const v = Number(n & 127n);
      n >>= 7n;
      out.push(v | (n ? 128 : 0));
    } while (n);

    return Uint8Array.from(out);
  };

  const bytesField = (n, b) =>
    concat(
      varint(BigInt(n) * 8n + 2n),
      varint(b.length),
      b
    );

  const stringField = (n, s) =>
    bytesField(n, utf8(s));

  const uintField = (n, v) =>
    BigInt(v) === 0n
      ? new Uint8Array()
      : concat(varint(BigInt(n) * 8n), varint(v));

  const coin = (denom, units) =>
    concat(stringField(1, denom), stringField(2, units));

  const any = (type, value) =>
    concat(stringField(1, type), bytesField(2, value));

  const encodePlan = (account, publicKey, units, fee) => {
    const message = concat(
      stringField(1, cfg.source),
      stringField(2, cfg.destination),
      bytesField(3, coin(cfg.tokenDenom, units))
    );

    const body = concat(
      bytesField(
        1,
        any("/cosmos.bank.v1beta1.MsgSend", message)
      ),
      stringField(2, memo)
    );

    const signer = concat(
      bytesField(
        1,
        any(
          "/cosmos.crypto.ed25519.PubKey",
          bytesField(1, publicKey)
        )
      ),
      // SIGN_MODE_LEGACY_AMINO_JSON = 127
      bytesField(2, bytesField(1, uintField(1, 127))),
      uintField(3, account.sequence)
    );

    const auth = concat(
      bytesField(1, signer),
      bytesField(
        2,
        concat(
          bytesField(1, coin(feeDenom, fee.units)),
          uintField(2, fee.gas)
        )
      )
    );

    const doc = {
      account_number: account.account_number,
      chain_id: chainId,
      fee: {
        amount: [
          { denom: feeDenom, amount: fee.units },
        ],
        gas: fee.gas,
      },
      memo,
      msgs: [
        {
          type: "cosmos-sdk/MsgSend",
          value: {
            from_address: cfg.source,
            to_address: cfg.destination,
            amount: [
              { denom: cfg.tokenDenom, amount: units },
            ],
          },
        },
      ],
      sequence: account.sequence,
    };

    return {
      body,
      auth,
      signText: JSON.stringify(sorted(doc)),
    };
  };

  const raw = (plan, signature) =>
    concat(
      bytesField(1, plan.body),
      bytesField(2, plan.auth),
      bytesField(3, signature)
    );

  let base;
  let busy = false;
  let attemptedBroadcast = false;
  let transactionHash = null;
  let sentPlan;
  let previewSignText = null;
  const pendingKey = "nolusTransfer.pending.v1";

  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingKey) || "null");

    if (
      saved &&
      /^[A-F0-9]{64}$/.test(saved.hash) &&
      /^nolus1/.test(saved.source) &&
      /^nolus1/.test(saved.destination) &&
      typeof saved.tokenDenom === "string" &&
      /^\d+$/.test(saved.units) &&
      (saved.tokenDecimals === null ||
        Number.isInteger(saved.tokenDecimals))
    ) {
      attemptedBroadcast = true;
      transactionHash = saved.hash;
      sentPlan = saved;
    }
  } catch (e) {
    console.warn("Could not restore a pending transaction:", e);
  }

  const request = async (
    path,
    payload,
    endpoint = base
  ) => {
    const response = await fetch(endpoint + path, {
      method: payload === undefined ? "GET" : "POST",
      headers:
        payload === undefined
          ? {}
          : { "Content-Type": "application/json" },
      body:
        payload === undefined
          ? undefined
          : JSON.stringify(payload),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        "Endpoint returned a non-JSON response."
      );
    }

    if (
      !response.ok ||
      (data.code && !data.tx_response)
    ) {
      throw new Error(
        `${response.status}: ${
          data.message || text.slice(0, 400)
        }`
      );
    }

    return data;
  };

  const fetchAssetCatalog = async () => {
    assetCatalog = new Map();
    feeDecimals = null;
    const data = await request("/api/currencies", undefined, location.origin);

    if (
      !data?.currencies ||
      typeof data.currencies !== "object" ||
      Array.isArray(data.currencies)
    ) {
      throw new Error("Nolus asset metadata is unavailable.");
    }

    const catalog = new Map();
    const conflicts = new Set();

    for (const item of Object.values(data.currencies)) {
      const denom = item?.bank_symbol;
      const symbol = item?.ticker;
      const decimals = item?.decimal_digits;

      if (
        typeof denom !== "string" ||
        typeof symbol !== "string" ||
        !symbol || symbol.length > 24 ||
        /[\x00-\x1f\x7f]/.test(symbol) ||
        !Number.isInteger(decimals) ||
        decimals < 0 || decimals > 36 ||
        conflicts.has(denom)
      ) {
        continue;
      }

      const previous = catalog.get(denom);

      if (previous &&
          (previous.symbol !== symbol || previous.decimals !== decimals)) {
        catalog.delete(denom);
        conflicts.add(denom);
      } else {
        catalog.set(denom, { symbol, decimals });
      }
    }

    const feeAsset = catalog.get(feeDenom);

    if (!feeAsset || feeAsset.symbol !== "USDC") {
      throw new Error("The exact Nolus USDC fee asset is missing from current metadata.");
    }

    assetCatalog = catalog;
    feeDecimals = feeAsset.decimals;
    return catalog;
  };

  const selectEndpoint = async () => {
    if (base) return;

    const errors = [];

    for (const candidate of endpoints) {
      try {
        const info = await request(
          "/cosmos/base/tendermint/v1beta1/node_info",
          undefined,
          candidate
        );

        if (
          info.default_node_info?.network !== chainId
        ) {
          throw new Error("Wrong network.");
        }

        base = candidate;
        return;
      } catch (e) {
        errors.push(`${candidate}: ${e.message}`);
      }
    }

    throw new Error(
      "No Nolus mainnet endpoint is reachable.\n" +
      errors.join("\n")
    );
  };

  const getBalances = async () => {
    decodeAddress(cfg.source);
    await selectEndpoint();

    const coins = [];
    const seen = new Set();
    let next = "";

    for (let page = 0; page < 10; page++) {
      const suffix = next
        ? `&pagination.key=${encodeURIComponent(next)}`
        : "";

      const result = await request(
        `/cosmos/bank/v1beta1/spendable_balances/` +
        `${cfg.source}?pagination.limit=100${suffix}`
      );

      if (!Array.isArray(result.balances)) {
        throw new Error(
          "Missing spendable balance data."
        );
      }

      coins.push(...result.balances);
      next = result.pagination?.next_key || "";

      if (!next) return coins;

      if (seen.has(next)) {
        throw new Error(
          "Endpoint returned a repeating pagination key."
        );
      }

      seen.add(next);
    }

    throw new Error(
      "Too many balance pages for this helper."
    );
  };

  const balances = async () => {
    const result = await getBalances();

    console.table(
      result.map((b) => ({
        Denom: b.denom,
        SpendableBaseUnits: b.amount,
      }))
    );

    console.log("These are exact spendable Nolus bank denominations.");

    return result;
  };

  const getAccount = async () => {
    const result = await request(
      `/cosmos/auth/v1beta1/accounts/${cfg.source}`
    );

    const a = result.account;

    if (
      a?.["@type"] !==
        "/cosmos.auth.v1beta1.BaseAccount" ||
      a.address !== cfg.source ||
      !/^\d+$/.test(a.account_number) ||
      !/^\d+$/.test(a.sequence)
    ) {
      throw new Error(
        "Expected an ordinary Nolus source account."
      );
    }

    return a;
  };

  const checkAccountKey = (account, publicKey) => {
    if (
      account.pub_key &&
      (
        account.pub_key["@type"] !==
          "/cosmos.crypto.ed25519.PubKey" ||
        !same(
          unbase64(account.pub_key.key),
          publicKey
        )
      )
    ) {
      throw new Error(
        "Source account is not controlled by " +
        "this Solana Ed25519 key."
      );
    }
  };

  const getSigner = async () => {
    const p =
      cfg.wallet === "phantom"
        ? (
            window.phantom?.solana ||
            (
              window.solana?.isPhantom
                ? window.solana
                : undefined
            )
          )
        : cfg.wallet === "solflare"
          ? window.solflare
          : undefined;

    if (
      !p ||
      typeof p.signMessage !== "function"
    ) {
      throw new Error(
        "Choose an installed Phantom or Solflare " +
        "wallet that supports message signing."
      );
    }

    // An already connected wallet exposes its public key without a prompt.
    // Connecting does not sign a transfer.
    if (!p.publicKey) await p.connect();

    const readKey = () => {
      if (!p.publicKey) {
        throw new Error("Wallet disconnected.");
      }

      const key = new Uint8Array(
        p.publicKey.toBytes
          ? p.publicKey.toBytes()
          : p.publicKey.toBuffer()
      );

      if (key.length !== 32) {
        throw new Error(
          "Expected a 32-byte Solana public key."
        );
      }

      return key;
    };

    const publicKey = readKey();

    // Nolus Ed25519 address payload: first 20 bytes of SHA-256(key).
    const derived = encodeAddress(
      (await sha256(publicKey)).slice(0, 20)
    );

    if (cfg.source && cfg.source !== derived) {
      throw new Error(
        "Wallet account changed. Close this panel and reload the page."
      );
    }

    cfg.source = derived;

    return {
      provider: p,
      publicKey,
      readKey,
      address: p.publicKey.toString(),
    };
  };

  const prepare = async (signer) => {
    decodeAddress(cfg.source);
    decodeAddress(cfg.destination);

    if (cfg.source === cfg.destination) {
      throw new Error(
        "Source and destination must differ."
      );
    }

    if (
      typeof cfg.tokenDenom !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9/:._-]{2,127}$/
        .test(cfg.tokenDenom)
    ) {
      throw new Error(
        "Set tokenDenom to the exact " +
        "on-Nolus bank denomination."
      );
    }

    if (
      cfg.tokenDecimals !== null &&
      (
        !Number.isInteger(cfg.tokenDecimals) ||
        cfg.tokenDecimals < 0 ||
        cfg.tokenDecimals > 36
      )
    ) {
      throw new Error(
        "Invalid verified token precision."
      );
    }

    if (
      typeof cfg.tokenSymbol !== "string" ||
      cfg.tokenSymbol.length > 24 ||
      /[\x00-\x1f\x7f]/.test(cfg.tokenSymbol)
    ) {
      throw new Error(
        "Use a short printable tokenSymbol label."
      );
    }

    if (
      !same(signer.readKey(), signer.publicKey)
    ) {
      throw new Error("Wallet account changed.");
    }

    const [account, coins, feeParams, gasConfig, catalog] =
      await Promise.all([
        getAccount(),
        getBalances(),
        request("/nolus/tax/v2/params"),
        request("/api/fees/gas-config", undefined, location.origin),
        fetchAssetCatalog(),
      ]);

    checkAccountKey(account, signer.publicKey);

    const currentAsset = catalog.get(cfg.tokenDenom);

    if (
      cfg.tokenSymbol !== (currentAsset?.symbol || "UNLISTED") ||
      cfg.tokenDecimals !== (currentAsset?.decimals ?? null)
    ) {
      throw new Error("Asset metadata changed. Select the asset again and preview anew.");
    }

    const balance = (d) =>
      BigInt(
        coins.find((b) => b.denom === d)?.amount ||
        "0"
      );

    const feeAsset = (
      feeParams.params?.dex_fee_params || []
    )
      .flatMap(
        (p) => p.accepted_denoms_min_prices || []
      )
      .find(
        (p) =>
          p.denom === feeDenom &&
          p.ticker === "USDC"
      );

    if (
      !feeAsset ||
      typeof gasConfig?.gas_prices?.[feeDenom] !== "string" ||
      typeof gasConfig?.gas_multiplier !== "number"
    ) {
      throw new Error(
        "Current USDC fee configuration is unavailable."
      );
    }

    const chainPrice = decimalRatio(feeAsset.min_price, "chain gas price");
    const appPrice = decimalRatio(gasConfig.gas_prices[feeDenom], "app gas price");
    const multiplier = decimalRatio(gasConfig.gas_multiplier, "gas multiplier");

    if (
      chainPrice.numerator <= 0n ||
      chainPrice.numerator * appPrice.denominator !==
        appPrice.numerator * chainPrice.denominator ||
      multiplier.numerator < multiplier.denominator ||
      multiplier.numerator > multiplier.denominator * 10n
    ) {
      throw new Error(
        "App and chain fee settings disagree or are unsupported."
      );
    }

    const feeForGas = (gas) => ceilDiv(
      chainPrice.numerator * gas,
      chainPrice.denominator
    );

    const unitsForFee = (feeUnits) => {
      const reserve = cfg.tokenDenom === feeDenom ? feeUnits : 0n;
      const available = balance(cfg.tokenDenom) - reserve;
      let units;

      if (cfg.amountMode === "all") {
        units = available;
      } else if (cfg.amountMode === "percent") {
        if (!/^\d{1,3}(\.\d{1,2})?$/.test(cfg.amount)) {
          throw new Error("Enter a percentage from 0.01 to 100.");
        }

        const [whole, fraction = ""] = cfg.amount.split(".");
        const basisPoints =
          BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));

        if (basisPoints <= 0n || basisPoints > 10000n) {
          throw new Error("Enter a percentage from 0.01 to 100.");
        }

        units = available * basisPoints / 10000n;
      } else if (cfg.amountMode === "units") {
        if (!/^\d{1,78}$/.test(cfg.amount)) {
          throw new Error("Enter a positive integer in base units.");
        }
        units = BigInt(cfg.amount);
      } else if (cfg.amountMode === "human" && cfg.tokenDecimals !== null) {
        units = toUnits(cfg.amount, cfg.tokenDecimals);
      } else {
        throw new Error("Choose a valid amount mode.");
      }

      if (
        units <= 0n ||
        units > (1n << 256n) - 1n ||
        units + reserve > balance(cfg.tokenDenom)
      ) {
        throw new Error(
          "Insufficient spendable token balance after reserving the fee."
        );
      }

      if (balance(feeDenom) < feeUnits) {
        throw new Error(
          "Insufficient USDC balance for the current Nolus network fee."
        );
      }

      return units;
    };

    let origin = cfg.tokenDenom;

    if (cfg.tokenDenom.startsWith("ibc/")) {
      if (
        !/^ibc\/[A-F0-9]{64}$/
          .test(cfg.tokenDenom)
      ) {
        throw new Error(
          "Invalid IBC denomination hash."
        );
      }

      const { denom } = await request(
        "/ibc/apps/transfer/v1/denoms/" +
        cfg.tokenDenom.slice(4)
      );

      if (
        !denom?.base ||
        !Array.isArray(denom.trace)
      ) {
        throw new Error(
          "Missing IBC denomination trace."
        );
      }

      const path = denom.trace
        .map(
          (p) =>
            `${p.port_id}/${p.channel_id}`
        )
        .join("/");

      origin = path
        ? `${path}/${denom.base}`
        : denom.base;

      const expectedDenom =
        "ibc/" +
        hex(
          await sha256(utf8(origin))
        ).toUpperCase();

      if (expectedDenom !== cfg.tokenDenom) {
        throw new Error(
          "IBC trace does not match the " +
          "selected denomination hash."
        );
      }
    }

    let gasLimit = initialSimulationGas;

    // A placeholder signature is used for every simulation. No wallet
    // signature is requested until the final sign document is stable.
    for (let attempt = 0; attempt < 6; attempt++) {
      const feeUnits = feeForGas(gasLimit);
      const units = unitsForFee(feeUnits);
      const fee = {
        gas: gasLimit.toString(),
        units: feeUnits.toString(),
      };
      const encoded = encodePlan(
        account,
        signer.publicKey,
        units.toString(),
        fee
      );

      if (utf8(encoded.signText).length > 1000) {
        throw new Error(
          "Signing JSON exceeds this helper's 1000-byte limit."
        );
      }

      const simulation = await request(
        "/cosmos/tx/v1beta1/simulate",
        {
          tx_bytes: base64(raw(encoded, new Uint8Array(64))),
        }
      );
      const gasUsed = BigInt(simulation.gas_info?.gas_used || "0");
      const recommendedGas = ceilDiv(
        gasUsed * multiplier.numerator,
        multiplier.denominator
      );

      if (gasUsed <= 0n || recommendedGas > 10000000n) {
        throw new Error("Simulated gas is outside the supported range.");
      }

      if (recommendedGas === gasLimit) {
        return {
          ...encoded,
          account,
          units: units.toString(),
          origin,
          gasUsed: gasUsed.toString(),
          gasMultiplier: String(gasConfig.gas_multiplier),
          gasPrice: gasConfig.gas_prices[feeDenom],
          fee,
        };
      }

      gasLimit = recommendedGas;
    }

    throw new Error("Gas estimate did not stabilize. Nothing was signed.");
  };

  const formatFee = (units) => feeDecimals === null
    ? `${units} base units of USDC`
    : `${formatUnits(units, feeDecimals)} USDC`;

  const show = (plan, signer) => {
    const details = {
      Network: chainId,
      Source: cfg.source,
      Destination: cfg.destination,
      TokenLabel: cfg.tokenSymbol || "TOKEN",
      TokenDenom: cfg.tokenDenom,
      DenomTrace: plan.origin,
      ConfiguredDecimals: cfg.tokenDecimals,
      Amount: formatUnits(plan.units, cfg.tokenDecimals ?? 0) +
        (cfg.tokenDecimals === null ? " base units" : ""),
      AmountBaseUnits: plan.units,
      Fee: `${formatFee(plan.fee.units)} on Nolus`,
      FeeBaseUnits: plan.fee.units,
      FeeDenom: feeDenom,
      GasLimit: plan.fee.gas,
      GasMultiplier: plan.gasMultiplier,
      GasPriceBaseUnitsPerGas: plan.gasPrice,
      SigningMode:
        "SIGN_MODE_LEGACY_AMINO_JSON",
      SolanaSigner: signer.address,
      SimulatedGas: plan.gasUsed,
    };

    console.table(details);

    console.log(
      "Exact Amino JSON that would " +
      "authorize this transfer:",
      plan.signText
    );

    return details;
  };

  const preview = async () => {
    if (busy) {
      throw new Error(
        "A send is already running."
      );
    }

    await selectEndpoint();

    const signer = await getSigner();
    const plan = await prepare(signer);
    const details = show(plan, signer);
    previewSignText = plan.signText;

    console.log(
      "Preview only. No transfer signature " +
      "was requested and nothing was broadcast."
    );

    return details;
  };

  const status = async () => {
    if (!transactionHash) {
      return {
        attemptedBroadcast,
        transactionHash,
      };
    }

    await selectEndpoint();

    const data = await request(
      `/cosmos/tx/v1beta1/txs/${transactionHash}`
    );

    const result = data.tx_response;

    if (
      result?.txhash?.toUpperCase() !==
      transactionHash
    ) {
      throw new Error(
        "Unexpected transaction hash " +
        "in status response."
      );
    }

    console.log(
      "Confirmed transaction result:",
      result
    );

    if (Number(result.code) !== 0) {
      try { sessionStorage.removeItem(pendingKey); } catch { /* Storage may be unavailable. */ }
      throw new Error(
        result.raw_log ||
        "Transaction execution failed."
      );
    }

    try { sessionStorage.removeItem(pendingKey); } catch { /* Storage may be unavailable. */ }

    console.log(
      "Transfer confirmed on Nolus:",
      {
        transactionHash,
        source: sentPlan.source,
        destination: sentPlan.destination,
        tokenDenom: sentPlan.tokenDenom,
        amountBaseUnits: sentPlan.units,
        amount: formatUnits(
          sentPlan.units,
          sentPlan.tokenDecimals ?? 0
        ),
        fee: sentPlan.feeUnits
          ? formatFee(sentPlan.feeUnits)
          : "Fee amount not saved by the previous script version",
      }
    );

    return result;
  };

  const send = async () => {
    if (busy || attemptedBroadcast) {
      throw new Error(
        "A send is running or was already " +
        "submitted. Check nolusTransfer.status(); " +
        "do not resubmit."
      );
    }

    busy = true;

    try {
      await selectEndpoint();

      const signer = await getSigner();
      const plan = await prepare(signer);

      if (!previewSignText || plan.signText !== previewSignText) {
        throw new Error(
          "Transaction changed since preview. Check it again before signing."
        );
      }

      show(plan, signer);

      const approved = window.confirm(
        "NOLUS MAINNET TOKEN TRANSFER\n\n" +
        `Source: ${cfg.source}\n` +
        `Destination: ${cfg.destination}\n` +
        "Amount: " +
        formatUnits(
          plan.units,
          cfg.tokenDecimals ?? 0
        ) +
        ` ${cfg.tokenDecimals === null ? "base units" : cfg.tokenSymbol}\n` +
        `Base units: ${plan.units}\n` +
        `Token denom: ${cfg.tokenDenom}\n` +
        `Fee: ${formatFee(plan.fee.units)} on Nolus\n` +
        `Gas limit: ${plan.fee.gas}\n\n` +
        "The wallet will sign Amino JSON. " +
        "THIS SIGNATURE AUTHORIZES " +
        "THIS TOKEN TRANSFER.\n\n" +
        "Continue to the wallet signing popup?"
      );

      if (!approved) {
        return { cancelled: true };
      }

      const fresh = await getAccount();

      checkAccountKey(
        fresh,
        signer.publicKey
      );

      if (
        fresh.sequence !==
          plan.account.sequence ||
        fresh.account_number !==
          plan.account.account_number
      ) {
        throw new Error(
          "Source account changed. Prepare " +
          "a new preview before signing."
        );
      }

      const bytes = utf8(plan.signText);

      const response =
        await signer.provider.signMessage(
          bytes,
          "utf8"
        );

      if (
        !same(
          signer.readKey(),
          signer.publicKey
        )
      ) {
        throw new Error(
          "Wallet account changed. " +
          "Nothing will be broadcast."
        );
      }

      const signature = new Uint8Array(
        response.signature || response
      );

      if (signature.length !== 64) {
        throw new Error(
          "Invalid signature length."
        );
      }

      const key =
        await crypto.subtle.importKey(
          "raw",
          signer.publicKey,
          { name: "Ed25519" },
          false,
          ["verify"]
        );

      const valid =
        await crypto.subtle.verify(
          "Ed25519",
          key,
          signature,
          bytes
        );

      if (!valid) {
        throw new Error(
          "Signature does not match the " +
          "exact transfer. Nothing will " +
          "be broadcast."
        );
      }

      const signed = raw(plan, signature);

      transactionHash = hex(
        await sha256(signed)
      ).toUpperCase();

      sentPlan = {
        source: cfg.source,
        destination: cfg.destination,
        tokenDenom: cfg.tokenDenom,
        tokenDecimals: cfg.tokenDecimals,
        units: plan.units,
        feeUnits: plan.fee.units,
        gasLimit: plan.fee.gas,
      };

      // One broadcast attempt per loaded helper.
      // A lost response must not trigger an automatic retry.
      attemptedBroadcast = true;

      try {
        sessionStorage.setItem(pendingKey, JSON.stringify({
          ...sentPlan,
          hash: transactionHash,
        }));
      } catch (e) {
        console.warn("Could not persist the transaction hash:", e);
      }

      console.log(
        "SAVE THIS NOLUS TRANSACTION HASH:",
        transactionHash
      );

      let submitted;

      try {
        submitted = await request(
          "/cosmos/tx/v1beta1/txs",
          {
            tx_bytes: base64(signed),
            mode: "BROADCAST_MODE_SYNC",
          }
        );
      } catch (e) {
        console.error(
          "Submission is uncertain. DO NOT " +
          "resend. Check nolusTransfer.status() " +
          "using the saved hash."
        );

        throw e;
      }

      const result = submitted.tx_response;

      if (
        !result ||
        Number(result.code) !== 0
      ) {
        throw new Error(
          result?.raw_log ||
          "Submission failed; save " +
          "the hash and error."
        );
      }

      if (
        result.txhash?.toUpperCase() !==
        transactionHash
      ) {
        throw new Error(
          "Unexpected submission hash. " +
          "Do not resubmit."
        );
      }

      console.log(
        "Accepted for broadcast, not yet " +
        "confirmed. After a few seconds run " +
        "await nolusTransfer.status()."
      );

      return {
        transactionHash,
        confirmed: false,
      };
    } finally {
      busy = false;
    }
  };

  const mountPanel = () => {
    const host = document.createElement("div");
    host.id = "nolus-transfer-panel-host";
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{all:initial;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#ecf0ff}
        *{box-sizing:border-box}
        .backdrop{position:fixed;inset:0;z-index:2147483647;background:#080e1acc;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px}
        .panel{width:min(100%,580px);background:#172033;border:1px solid #475471;border-radius:18px;padding:24px;box-shadow:0 20px 70px #0009}
        h2{font-size:22px;margin:0 0 8px;color:#fff}h3{font-size:16px;margin:24px 0 10px;color:#fff}
        p{line-height:1.45;color:#b9c6df;margin:8px 0 14px}
        .top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        label{display:block;font-weight:600;margin:16px 0 7px;color:#e5ebff}
        input:not([type=checkbox]),select{display:block;width:100%;border:1px solid #697896;border-radius:9px;background:#0b1426;color:#fff;padding:11px 12px;font:inherit}
        input:focus,select:focus,button:focus-visible{outline:2px solid #b4c4ff;outline-offset:2px}
        button{border:0;border-radius:9px;background:#687cff;color:#fff;padding:11px 15px;font:inherit;font-weight:650;cursor:pointer}
        button:hover{background:#8493ff}button:disabled{opacity:.5;cursor:not-allowed}
        .secondary{background:#354663}.secondary:hover{background:#475c80}
        .row{display:flex;gap:9px;flex-wrap:wrap}.row input{flex:1;min-width:160px}
        .small{font-size:13px;overflow-wrap:anywhere}.address,.denom,.hash{font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere;color:#fff}
        .notice{padding:12px;border-radius:9px;background:#352d22;color:#ffe0a6}
        .error{color:#ffabab}.success{color:#a2e7bf}
        dl{display:grid;grid-template-columns:130px 1fr;gap:9px;font-size:14px}dt{color:#aebbd3}dd{margin:0;overflow-wrap:anywhere}
        .check{display:flex;gap:8px;align-items:flex-start;font-weight:400;line-height:1.45}
        .check input{margin-top:4px}.hidden{display:none!important}
        @media(max-width:500px){.backdrop{padding:8px}.panel{padding:16px}dl{grid-template-columns:1fr;gap:3px}dd{margin-bottom:7px}}
      </style>
      <div class="backdrop">
        <main class="panel" role="dialog" aria-modal="true" aria-label="Nolus asset transfer">
          <div class="top"><div><h2>Transfer assets on Nolus</h2><p>From a Nolus account linked to Phantom or Solflare.</p></div><button id="close" class="secondary" type="button" aria-label="Close">×</button></div>
          <div id="wallet-choices" class="row hidden"><button id="phantom" type="button">Use Phantom</button><button id="solflare" class="secondary" type="button">Use Solflare</button></div>
          <div id="wallet-details" class="hidden"><p class="small">Solana wallet: <span id="solana" class="address"></span></p><p class="small">Nolus source address: <span id="source" class="address"></span></p></div>
          <section id="form" class="hidden">
            <label for="asset">Spendable asset</label><select id="asset"></select>
            <p id="balance" class="small"></p><p id="denom" class="small denom"></p>
            <label for="destination">Destination Nolus address</label><input id="destination" autocomplete="off" spellcheck="false" placeholder="nolus1...">
            <label for="mode">Amount format</label><select id="mode"></select>
            <label for="amount">Amount</label><div class="row"><input id="amount" autocomplete="off" inputmode="decimal" placeholder="Enter amount"><button id="max" class="secondary" type="button">Max</button></div>
            <p id="unit-note" class="small"></p>
            <p class="small">Network fee and gas limit are calculated from current Nolus settings during preview. The source needs USDC on Nolus to pay the fee.</p>
            <button id="preview" type="button">Preview transfer</button>
          </section>
          <section id="review" class="hidden"><h3>Review transfer</h3><dl id="review-list"></dl><p class="notice">The wallet's message signature authorizes this Nolus token transfer.</p><label class="check"><input id="ack" type="checkbox">I checked the destination, amount, denomination, and fee.</label><p><button id="send" type="button" disabled>Sign and transfer</button></p></section>
          <section id="tracking" class="hidden"><h3>Track transaction</h3><p class="small">Hash: <span id="hash" class="hash"></span></p><button id="status" class="secondary" type="button">Check status</button><p id="tx-result" role="status"></p></section>
          <p id="message" role="status" aria-live="polite"></p>
          <p class="small">Transfers only between nolus1... addresses. No bridge or swap. Never enter a seed phrase or private key.</p>
        </main>
      </div>`;

    const $ = (id) => root.getElementById(id);
    let coins = [];
    let previewReady = false;
    let working = false;

    const message = (value, kind = "") => {
      $("message").textContent = value;
      $("message").className = kind;
    };

    const stale = () => {
      previewReady = false;
      previewSignText = null;
      $("review").classList.add("hidden");
      $("ack").checked = false;
      $("send").disabled = true;
    };

    const run = async (action) => {
      if (working) return;
      working = true;
      message("Working...");
      for (const id of ["phantom", "solflare", "asset", "destination", "mode", "amount", "max", "preview", "send"]) {
        $(id).disabled = true;
      }

      try {
        await action();
      } catch (e) {
        console.error("Nolus transfer:", e);
        message(e.message || String(e), "error");
      } finally {
        working = false;
        for (const id of ["phantom", "solflare", "asset", "destination", "mode", "amount", "max", "preview"]) {
          $(id).disabled = false;
        }
        $("amount").disabled = $("mode").value === "all";
        $("send").disabled = !previewReady || !$("ack").checked || attemptedBroadcast;
      }
    };

    const selectedCoin = () => coins.find((b) => b.denom === $("asset").value);

    const updateAsset = () => {
      stale();
      const coin = selectedCoin();
      if (!coin) return;

      const known = assetCatalog.get(coin.denom);
      cfg.tokenDenom = coin.denom;
      cfg.tokenSymbol = known?.symbol || "UNLISTED";
      cfg.tokenDecimals = known?.decimals ?? null;
      $("balance").textContent = known
        ? `Spendable balance: ${formatUnits(coin.amount, known.decimals)} ${known.symbol} (${coin.amount} base units)`
        : `Spendable balance: ${coin.amount} base units`;
      $("denom").textContent = `Denom: ${coin.denom}`;

      const mode = $("mode");
      mode.replaceChildren();
      const choices = known
        ? [["human", known.symbol], ["percent", "% of balance"], ["units", "Base units"], ["all", "Entire balance"]]
        : [["percent", "% of balance"], ["units", "Base units"], ["all", "Entire balance"]];

      for (const [value, label] of choices) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        mode.append(option);
      }

      $("amount").value = "";
      updateMode();
    };

    const updateMode = () => {
      stale();
      const mode = $("mode").value;
      $("amount").disabled = mode === "all";
      $("amount").placeholder =
        mode === "human" ? "Example: 0.01" :
        mode === "percent" ? "Example: 25 or 12.5" :
        mode === "units" ? "Whole number of base units" : "Entire balance after fee reserve, if needed";
      $("unit-note").textContent = cfg.tokenDecimals === null
        ? "Token decimals are unverified. Use a balance percentage or base units; no token-unit conversion is assumed."
        : `1 ${cfg.tokenSymbol} = 10^${cfg.tokenDecimals} base units.`;
    };

    const loadWallet = async (kind) => run(async () => {
      try {
      stale();
      cfg.wallet = kind;
      cfg.source = "";
      const signer = await getSigner();
      await selectEndpoint();
      const [balancesResult, catalogResult] = await Promise.allSettled([
        getBalances(),
        fetchAssetCatalog(),
      ]);

      if (balancesResult.status === "rejected") throw balancesResult.reason;
      coins = balancesResult.value.filter(
        (b) => /^\d+$/.test(b.amount) && BigInt(b.amount) > 0n
      );

      if (catalogResult.status === "rejected") {
        console.warn("Asset metadata is unavailable:", catalogResult.reason);
      }
      $("solana").textContent = signer.address;
      $("source").textContent = cfg.source;
      $("wallet-details").classList.remove("hidden");
      $("wallet-choices").classList.add("hidden");
      $("form").classList.remove("hidden");
      $("asset").replaceChildren();

      for (const coin of coins) {
        const option = document.createElement("option");
        option.value = coin.denom;
        option.textContent = `${assetCatalog.get(coin.denom)?.symbol || "Unlisted"} - ${coin.denom.length > 28 ? coin.denom.slice(0, 28) + "..." : coin.denom}`;
        $("asset").append(option);
      }

      if (!coins.length) {
        $("form").classList.add("hidden");
        message("This Nolus account has no spendable assets.");
        return;
      }

      const firstKnown = coins.findIndex((b) => assetCatalog.has(b.denom));
      if (firstKnown >= 0) $("asset").selectedIndex = firstKnown;
      updateAsset();
      message(attemptedBroadcast
        ? "A transaction was broadcast. Check its hash before starting another transfer."
        : catalogResult.status === "rejected"
          ? `Found ${coins.length} spendable assets. Metadata is unavailable; preview will retry.`
          : `Found ${coins.length} spendable assets on Nolus. Select one to transfer.`,
      attemptedBroadcast || catalogResult.status === "rejected" ? "" : "success");
      } catch (e) {
        $("wallet-choices").classList.remove("hidden");
        $("form").classList.add("hidden");
        throw e;
      }
    });

    const readForm = () => {
      cfg.destination = $("destination").value.trim();
      cfg.amountMode = $("mode").value;
      cfg.amount = $("amount").value.trim();
    };

    $("close").addEventListener("click", () => { host.style.display = "none"; });
    $("phantom").addEventListener("click", () => loadWallet("phantom"));
    $("solflare").addEventListener("click", () => loadWallet("solflare"));
    $("asset").addEventListener("change", updateAsset);
    $("mode").addEventListener("change", updateMode);
    $("destination").addEventListener("input", stale);
    $("amount").addEventListener("input", stale);
    $("max").addEventListener("click", () => { $("mode").value = "all"; updateMode(); });
    $("ack").addEventListener("change", () => {
      $("send").disabled = !previewReady || !$("ack").checked || attemptedBroadcast;
    });

    $("preview").addEventListener("click", () => run(async () => {
      stale();
      readForm();
      const details = await preview();
      const list = $("review-list");
      list.replaceChildren();

      for (const [key, value] of Object.entries(details)) {
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = key;
        dd.textContent = String(value);
        list.append(dt, dd);
      }

      $("review").classList.remove("hidden");
      previewReady = true;
      message("Simulation succeeded. Review every field before signing.", "success");
    }));

    $("send").addEventListener("click", () => run(async () => {
      if (!previewReady || !$("ack").checked) return;
      readForm();

      try {
        const result = await send();
        if (result.cancelled) {
          message("Cancelled before signing.");
          return;
        }
        message("Node accepted the transaction. Check its on-chain status.", "success");
      } finally {
        if (transactionHash) {
          $("hash").textContent = transactionHash;
          $("tracking").classList.remove("hidden");
        }
        stale();
      }
    }));

    $("status").addEventListener("click", () => run(async () => {
      const result = await status();
      $("tx-result").textContent = Number(result.code) === 0
        ? "Confirmed on Nolus."
        : "Transaction is not confirmed.";
      $("tx-result").className = Number(result.code) === 0 ? "success" : "";
      message("Transaction status updated.", "success");
    }));

    const phantom = window.phantom?.solana ||
      (window.solana?.isPhantom ? window.solana : undefined);
    const solflare = window.solflare;
    const connected = phantom?.publicKey ? "phantom" :
      solflare?.publicKey ? "solflare" : "";

    if (transactionHash) {
      $("hash").textContent = transactionHash;
      $("tracking").classList.remove("hidden");
    }

    if (connected) {
      loadWallet(connected);
    } else {
      $("wallet-choices").classList.remove("hidden");
      message(transactionHash
        ? "A prior transaction has an uncertain result. Check its hash before sending again."
        : "Choose the Phantom or Solflare wallet connected to Nolus.");
    }

    return () => { host.style.display = ""; };
  };

  const decimalRatio = (value, label) => {
    const decimal = String(value);

    if (!/^\d+(\.\d{1,18})?$/.test(decimal)) {
      throw new Error(`Invalid ${label} from Nolus fee configuration.`);
    }

    const [whole, fraction = ""] = decimal.split(".");
    return {
      numerator: BigInt(whole + fraction),
      denominator: 10n ** BigInt(fraction.length),
    };
  };

  const ceilDiv = (n, d) => (n + d - 1n) / d;

  let openPanel;
  window.nolusTransfer = Object.freeze({
    balances,
    preview,
    send,
    status,
    open: () => openPanel?.(),
  });

  openPanel = mountPanel();
  console.log("Nolus transfer panel opened. Only 'Sign and transfer' signs and broadcasts.");
})().catch((error) =>
  console.error(
    "Nolus transfer helper stopped:",
    error
  )
);
