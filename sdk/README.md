# PrivacyCloak — SDK

Official SDKs for integrating the Universal Privacy Layer into your application.

## Python SDK

```bash
pip install upl-sdk
```

```python
from upl_sdk import UPL

upl = UPL(base_url="https://privacycloak.in", token="your_session_token")

# Stealth address
stealth = upl.generate_stealth_address(spend_key, view_key)

# Uniswap V3 private swap quote
quote = upl.get_uniswap_quote("base", "ETH", "USDC", "0.5", stealth.address)

# Hyperliquid private trade
trade = upl.prepare_hyperliquid_trade("0x...", "ETH", True, 100, leverage=5)

# Polymarket private bet
bet = upl.prepare_polymarket_bet("0x...", "condition_id", "1", "YES", 50.0)

# Hidden balance
balance = upl.get_hidden_balance("0x...")
```

## JavaScript / TypeScript SDK

```bash
npm install upl-sdk
```

```typescript
import UPL from "upl-sdk";

const upl = new UPL({ baseUrl: "https://privacycloak.in", token: "your_session_token" });

const quote = await upl.getUniswapQuote({
  chain: "base", tokenIn: "ETH", tokenOut: "USDC",
  amountIn: "0.5", stealthRecipient: "0x..."
});

const trade = await upl.prepareHyperliquidTrade({
  traderAddress: "0x...", asset: "ETH", isBuy: true,
  sizeUsd: 100, leverage: 5
});
```

## Methods

| Method | Description |
|--------|-------------|
| `generate_stealth_address` | Generate a one-time stealth address |
| `get_hidden_balance` | Aggregate balance across stealth addresses |
| `private_send` | Send tokens via privacy relayer |
| `get_uniswap_quote` | Get Uniswap V3 quote (privacy-routed) |
| `get_hyperliquid_markets` | List 229 available perp markets |
| `prepare_hyperliquid_trade` | Prepare stealth-proxied perp trade |
| `get_polymarket_markets` | List active prediction markets |
| `prepare_polymarket_bet` | Prepare stealth-proxied USDC bet |
| `generate_zkp_proof` | Generate Groth16 ZK proof |
| `verify_zkp_proof` | Verify proof on-chain |
