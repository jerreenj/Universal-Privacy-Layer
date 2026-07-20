# Bundle Size Baseline

**Generated:** Commit before bundle trim optimization  
**Build command:** `yarn build`  
**Analyzer:** source-map-explorer v2.5.3

## Current State

### Total Bundle
- **Total size:** 20,129 KB (20 MB) across 147 files
- **Production JS only:** ~6,000 KB (excluding source maps)

### Top 10 Largest Files (Production Only)

| File | Size | Notes |
|------|------|-------|
| `8326.f9cff12e.chunk.js` | **2,906 KB** | ⚠️ **CRITICAL** - Massive chunk, likely contains crypto/blockchain libs |
| `main.7423a5d0.js` | **407 KB** | Main bundle (React, app code, initial deps) |
| `9620.f6b611e9.chunk.js` | 381 KB | Lazy chunk |
| `8985.ea2137ed.chunk.js` | 284 KB | Lazy chunk |
| `9979.3f4e0e88.chunk.js` | 205 KB | Lazy chunk |
| `6159.1bf0f741.chunk.js` | 156 KB | Lazy chunk |
| `9386.be66e3c8.chunk.js` | 176 KB | Lazy chunk |
| `2653.ec324738.chunk.js` | 90 KB | Lazy chunk |
| `5808.f076d8dc.chunk.js` | ~80 KB | Lazy chunk |
| `7693.2f82e596.chunk.js` | ~66 KB | Lazy chunk |

### Source Maps (Development Only)
- `8326.f9cff12e.chunk.js.map` - 4,625 KB
- `main.7423a5d0.js.map` - 2,067 KB
- (Plus 145 more .map files)

## Heavy Dependencies (Candidates for Lazy Loading)

### 🔴 Critical (Must Lazy Load)
These are the likely contents of the 2.9MB `8326` chunk:

1. **`@mysten/sui`** (Sui SDK) - ~800KB+
   - Used: Mobile/desktop wallet connect
   - Fix: Dynamic import only when Sui wallet selected

2. **`@solana/web3.js`** (Solana SDK) - ~600KB+
   - Used: Solana wallet connect
   - Fix: Dynamic import only when Phantom/Solana wallet selected

3. **`ethers`** (Ethereum library) - ~500KB+
   - Used: All EVM wallet interactions
   - Fix: Dynamic import on first wallet connect

4. **`@walletconnect/sign-client`** (WalletConnect) - ~400KB+
   - Used: Rabby wallet, fallback connection
   - Fix: Dynamic import only when WalletConnect needed

5. **`circomlibjs`** (ZK crypto) - ~300KB+
   - Used: ZK proof generation
   - Fix: Dynamic import only when ZK features accessed

6. **`snarkjs`** (ZK proofs) - ~250KB+
   - Used: Groth16 proof generation/verification
   - Fix: Dynamic import only when ZK features accessed

### 🟡 Moderate (Consider Lazy Loading)
These add up to significant size:

7. **20+ Radix UI components** - ~400KB total
   - Each component ~15-25KB
   - Consider: Only load components when features accessed

8. **`d3`** (visualization) - ~200KB
   - Used: Globe animation, charts
   - Fix: Dynamic import if globe not shown on mobile

9. **`framer-motion`** (animations) - ~150KB
   - Used: Page transitions, animations
   - Consider: Tree-shaking unused animations

10. **`lucide-react`** (icons) - ~100KB
    - 500+ icons, likely using 50-100
    - Fix: Import only used icons

11. **`recharts`** (charts) - ~150KB
    - Used: Transaction history charts
    - Fix: Dynamic import only on history page

### 🟢 Small (Acceptable Size)
- `axios` - 15KB (HTTP client, needed everywhere)
- `react` + `react-dom` - 130KB (core, must be loaded)
- `react-router-dom` - 40KB (routing, needed everywhere)
- `zod` - 30KB (validation, used in forms)
- `date-fns` - 20KB (date formatting)
- `sonner` - 10KB (toast notifications)

## Targets

### Phase 1: Quick Wins (Commit 2)
- **Goal:** Reduce main.js from 407KB → ~250KB
- **Method:** Lazy load crypto libs in desktop wallet connect (mirror mobile pattern)
- **Expected savings:** ~150KB from main bundle

### Phase 2: Split the Monster (Commit 3)
- **Goal:** Break 8326 chunk (2.9MB) into feature-gated lazy chunks
- **Method:** Identify what's in it via source map, code-split by feature
- **Target:** No chunk over 500KB

### Phase 3: Optimization (Commit 4)
- **Goal:** All chunks under 500KB, main under 200KB
- **Method:** Tree-shake Radix UI, lucide-react, framer-motion
- **Verification:** Re-run build, test wallet connect works

## Success Metrics

**Baseline (now):**
- Main bundle: 407 KB
- Largest chunk: 2,906 KB
- Total production JS: ~6,000 KB

**Target (after all commits):**
- Main bundle: <200 KB (50% reduction)
- Largest chunk: <500 KB (83% reduction)
- Total production JS: ~4,000 KB (33% reduction)

## Files to Modify

1. `src/context/WalletContext.jsx` - Add desktop lazy imports
2. `src/components/features/*` - Lazy load heavy feature components
3. `src/App.jsx` - Wrap routes in React.lazy
4. `src/components/ui/RotatingEarth.jsx` - Lazy load d3

## Next Steps

1. ✅ Commit this baseline document
2. ⏭️ Commit 2: Add lazy imports to WalletContext (desktop)
3. ⏭️ Commit 3: Investigate and split the 8326 chunk
4. ⏭️ Commit 4: Final optimization and verification
