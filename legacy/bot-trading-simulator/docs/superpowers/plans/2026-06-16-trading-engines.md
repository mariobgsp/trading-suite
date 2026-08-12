# Crossover Trading Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace existing trading engines with three new indicator crossover-based engines (Stochastic, MACD, and MA Crossing) to integrate with the AI Brain system.

**Architecture:** Remove `FVGPullbackEngine`, `MomentumBreakoutEngine`, and `BuyingOnWeaknessEngine` from `core/engines.py`. Add `StochasticEngine`, `MACDEngine`, and `MACrossingEngine`. Ensure they implement the `scan(self, df: pd.DataFrame, ticker: str, regime: str)` interface. Update the `ENGINE_MAP` and class exports. Update test fixtures where necessary if engines are hardcoded.

**Tech Stack:** Python, Pandas, Numpy

---

### Task 1: Clean up old engines and setup scaffold

**Files:**
- Modify: `core/engines.py`

- [ ] **Step 1: Remove old engine classes**
Delete `FVGPullbackEngine`, `MomentumBreakoutEngine`, and `BuyingOnWeaknessEngine` from `core/engines.py`.

- [ ] **Step 2: Update imports in `core/engines.py`**
Make sure the indicators `sma`, `macd`, `stochastic_oscillator` and `volume_ratio` are imported from `core.indicators` alongside `ema`. Remove unused imports related to old engines if possible (like `FVG_LOW_VOLUME_RATIO`, etc., if they were defined in settings).

```python
from core.indicators import (
    sma,
    macd,
    stochastic_oscillator,
    volume_ratio,
)
```

- [ ] **Step 3: Define scaffold for the new engines**
Create empty class definitions for the 3 new engines.

```python
class StochasticEngine(ABC):
    pass

class MACDEngine(ABC):
    pass

class MACrossingEngine(ABC):
    pass
```

- [ ] **Step 4: Commit**
```bash
git add core/engines.py
git commit -m "refactor: remove old engines and setup scaffold for crossover engines"
```

### Task 2: Implement StochasticEngine

**Files:**
- Modify: `core/engines.py`

- [ ] **Step 1: Implement StochasticEngine class logic**

```python
class StochasticEngine:
    """
    Priority 3 Engine: Stochastic Crossover
    Triggers when Fast %K crosses above %D from below in oversold territory, with volume > SMA 20.
    """
    
    def __init__(self):
        self.priority = 3
        self.name = "Stochastic Cross"
        
    def scan(self, df: pd.DataFrame, ticker: str, regime: str) -> EntrySignal | None:
        if len(df) < 20:
            return None
            
        # Get Stochastic %K and %D
        k_series, d_series = stochastic_oscillator(df, k_period=14, d_period=3)
        
        k_today = k_series.iloc[-1]
        k_yest = k_series.iloc[-2]
        d_today = d_series.iloc[-1]
        d_yest = d_series.iloc[-2]
        
        # Check Cross above: K was below D yesterday, K is above D today
        cross_above = k_yest <= d_yest and k_today > d_today
        
        # Check Oversold (e.g. K < 20 at time of cross)
        is_oversold = k_today < 20.0
        
        # Volume filter
        vol_sma20 = sma(df["Volume"], 20).iloc[-1]
        vol_today = df["Volume"].iloc[-1]
        vol_confirmed = vol_today > vol_sma20
        
        if cross_above and is_oversold and vol_confirmed:
            return EntrySignal(
                engine=self.name,
                ticker=ticker,
                price=float(df["Close"].iloc[-1]),
                score=self.priority * 1.5, # Base score calculation
                priority=self.priority,
                details={"k": round(k_today, 2), "d": round(d_today, 2)}
            )
            
        return None
```

- [ ] **Step 2: Commit**
```bash
git add core/engines.py
git commit -m "feat: implement StochasticEngine"
```

### Task 3: Implement MACDEngine

**Files:**
- Modify: `core/engines.py`

- [ ] **Step 1: Implement MACDEngine class logic**

```python
class MACDEngine:
    """
    Priority 2 Engine: MACD Crossover
    Triggers when MACD Line crosses above Signal Line, with volume > SMA 20.
    """
    
    def __init__(self):
        self.priority = 2
        self.name = "MACD Cross"
        
    def scan(self, df: pd.DataFrame, ticker: str, regime: str) -> EntrySignal | None:
        if len(df) < 35:
            return None
            
        macd_line, signal_line, _ = macd(df["Close"], fast=12, slow=26, signal=9)
        
        m_today = macd_line.iloc[-1]
        m_yest = macd_line.iloc[-2]
        s_today = signal_line.iloc[-1]
        s_yest = signal_line.iloc[-2]
        
        cross_above = m_yest <= s_yest and m_today > s_today
        
        # Volume filter
        vol_sma20 = sma(df["Volume"], 20).iloc[-1]
        vol_today = df["Volume"].iloc[-1]
        vol_confirmed = vol_today > vol_sma20
        
        if cross_above and vol_confirmed:
            return EntrySignal(
                engine=self.name,
                ticker=ticker,
                price=float(df["Close"].iloc[-1]),
                score=self.priority * 1.5,
                priority=self.priority,
                details={"macd": round(m_today, 4), "signal": round(s_today, 4)}
            )
            
        return None
```

- [ ] **Step 2: Commit**
```bash
git add core/engines.py
git commit -m "feat: implement MACDEngine"
```

### Task 4: Implement MACrossingEngine

**Files:**
- Modify: `core/engines.py`

- [ ] **Step 1: Implement MACrossingEngine class logic**

```python
class MACrossingEngine:
    """
    Priority 1 Engine: MA Crossing
    Triggers when SMA 20 crosses above SMA 50 while Close > SMA 200, with volume > SMA 20.
    """
    
    def __init__(self):
        self.priority = 1
        self.name = "MA Cross"
        
    def scan(self, df: pd.DataFrame, ticker: str, regime: str) -> EntrySignal | None:
        if len(df) < 200:
            return None
            
        sma20 = sma(df["Close"], 20)
        sma50 = sma(df["Close"], 50)
        sma200 = sma(df["Close"], 200)
        
        sma20_today = sma20.iloc[-1]
        sma20_yest = sma20.iloc[-2]
        sma50_today = sma50.iloc[-1]
        sma50_yest = sma50.iloc[-2]
        
        cross_above = sma20_yest <= sma50_yest and sma20_today > sma50_today
        above_200 = df["Close"].iloc[-1] > sma200.iloc[-1]
        
        # Volume filter
        vol_sma20 = sma(df["Volume"], 20).iloc[-1]
        vol_today = df["Volume"].iloc[-1]
        vol_confirmed = vol_today > vol_sma20
        
        if cross_above and above_200 and vol_confirmed:
            return EntrySignal(
                engine=self.name,
                ticker=ticker,
                price=float(df["Close"].iloc[-1]),
                score=self.priority * 1.5,
                priority=self.priority,
                details={"sma20": round(sma20_today, 2), "sma50": round(sma50_today, 2)}
            )
            
        return None
```

- [ ] **Step 2: Update ALL_ENGINES list in `core/engines.py`**
If `core/engines.py` defines a list of engines, export the new ones.
Modify `core/engines.py` near the bottom to instantiate and expose the new engines. Replace the old engines list with:
```python
ALL_ENGINES = [
    StochasticEngine(),
    MACDEngine(),
    MACrossingEngine()
]
```

- [ ] **Step 3: Commit**
```bash
git add core/engines.py
git commit -m "feat: implement MACrossingEngine and update ALL_ENGINES"
```

### Task 5: Run tests and verify backtest

**Files:**
- Read/Execute

- [ ] **Step 1: Run integration test**
```bash
python -m pytest scripts/test_integration.py -v
```
Expected: PASS. If fails due to missing old engine references, update `scripts/test_integration.py` to remove those references and add new engines.

- [ ] **Step 2: Run a quick backtest or scan**
```bash
python -m scripts.scan
```
Expected: Script completes successfully.

- [ ] **Step 3: Commit**
If test file changes were made:
```bash
git add scripts/test_integration.py
git commit -m "test: update integration tests for new engines"
```
