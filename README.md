# Nolus linked wallet transfer

A single browser-console script for transferring spendable bank assets between two Nolus accounts. It works with Nolus accounts controlled by a Phantom or Solflare Solana key, including assets that the Nolus app does not display.

The script runs only on `https://app.nolus.io/`. It does not bridge, swap, or move tokens to Solana. The signing wallet never shares its seed phrase or private key with the script.

## Requirements

- Phantom or Solflare installed and connected at `https://app.nolus.io/`.
- A spendable asset balance on the linked Nolus account.
- USDC **on Nolus** for the network fee. The exact fee denomination is `ibc/3E507F7BA8D40C5CDFFB74234444ECEB6889562B82DE70E70F9EA8DE16B3D452`.
- A destination Nolus address beginning with `nolus1`.

## Use

1. Open `https://app.nolus.io/` and connect Phantom or Solflare.
2. Open the browser Developer Tools Console.
3. Review and paste the entire contents of [`nolus-linked-wallet-transfer.js`](./nolus-linked-wallet-transfer.js) into the Console.
4. Check the derived Nolus source address shown in the panel. Select a spendable asset.
5. Enter the destination `nolus1...` address and amount, or choose **Max**. Assets with verified decimals use token units. Assets with unverified decimals use a balance percentage or exact base units.
6. Select **Preview transfer**. Check the destination, amount, exact bank denomination, fee, gas limit, and IBC trace.
7. Select **Sign and transfer** only after reviewing every field. The wallet's `signMessage` request authorizes the Nolus transfer. Save the transaction hash and use **Check status** until Nolus confirms it.

Only the final **Sign and transfer** step requests a transfer signature or broadcasts a transaction. Closing the panel does not cancel a transaction already broadcast. Reload the page to load a fresh copy of the script.

## Fee and gas

The script reads the current USDC minimum gas price from Nolus chain parameters and the gas estimate multiplier from the Nolus app's `/api/fees/gas-config` endpoint. It simulates the transfer, calculates the gas limit and USDC fee with integer arithmetic, and simulates the final plan again. It stops if the app and chain fee settings disagree or the source lacks enough USDC.

The first simulation starts with a temporary `250000` gas limit. The final signed gas limit and fee come from the current configuration and simulation. The full signed fee is charged even if on-chain gas usage is lower than the gas limit.

## Scope and safeguards

- Mainnet chain ID: `pirin-1`.
- Transaction type: Cosmos bank `MsgSend` between Nolus addresses.
- The source address is derived from the connected Solana public key and checked against the Nolus Ed25519 account.
- The IBC trace hash, spendable balance, accepted fee denomination, wallet key, signature, and account sequence are checked before broadcast.
- Preview and send must produce the same Amino sign document. A changed transaction requires a new preview.
- One broadcast attempt is allowed per loaded script. The transaction hash is kept in browser session storage so a reload can restore status checking after an uncertain response.
- The asset list comes from the linked account's on-chain spendable balances. Labels and decimals are fetched at runtime from Nolus `/api/currencies` by exact bank denomination, including inactive catalog entries. Assets without consistent catalog metadata remain selectable without guessing their decimals.

This helper has not been audited. Inspect the exact Amino JSON in the Console and the on-page review before signing. For a first transfer, use a small amount and confirm the destination balance on Nolus.
