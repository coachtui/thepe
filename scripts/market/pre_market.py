import urllib.request
import urllib.parse
import json
import time
import math
import datetime
import os
import sys

RESEND_API_KEY = os.environ["RESEND_API_KEY"]
TO_EMAIL = "tui@tuialailima.com"

WATCHLIST = [
    "AMGN","AMZN","APLD","AXTI","BE","BRK-B","CLS","COHR","CRDO","CRWD",
    "FSLY","GOOGL","HOOD","IREN","LLY","MSFT","MU","NVDA","PLTR","QBTS",
    "SKM","SMH","TEM","TSM"
]
BROADER = ["ES=F","NQ=F","YM=F","^VIX","CL=F","GC=F","^TNX"]

HEADERS = {"User-Agent": "Mozilla/5.0"}

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def get_quote(ticker, range_="2d", include_pre_post=True):
    params = urllib.parse.urlencode({
        "interval": "1d", "range": range_,
        "includePrePost": "true" if include_pre_post else "false"
    })
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?{params}"
    try:
        data = fetch(url)
        meta = data["chart"]["result"][0]["meta"]
        return meta
    except Exception as e:
        return None

def get_history(ticker):
    params = urllib.parse.urlencode({"interval": "1d", "range": "90d"})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?{params}"
    try:
        data = fetch(url)
        closes = data["chart"]["result"][0]["indicators"]["quote"][0]["close"]
        return [c for c in closes if c is not None]
    except Exception:
        return []

def get_news(ticker):
    params = urllib.parse.urlencode({"q": ticker, "newsCount": "3", "quotesCount": "0"})
    url = f"https://query2.finance.yahoo.com/v1/finance/search?{params}"
    try:
        data = fetch(url)
        news = data.get("news", [])
        now = time.time()
        recent = [n["title"] for n in news if now - n.get("providerPublishTime", 0) < 86400]
        return recent[:2]
    except Exception:
        return []

def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    gains = [max(d, 0) for d in deltas[-period:]]
    losses = [abs(min(d, 0)) for d in deltas[-period:]]
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def sma(closes, n):
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n

def pct(a, b):
    if b == 0:
        return 0
    return (a - b) / b * 100

today = datetime.datetime.now()
subject = f"Pre-Market -- {today.strftime('%A %B %d, %Y')}"

lines = []

# Section 1: MARKET TONE
lines.append("=" * 60)
lines.append("SECTION 1 -- MARKET TONE")
lines.append("=" * 60)
broader_data = {}
for ticker in BROADER:
    meta = get_quote(ticker)
    time.sleep(0.3)
    if meta:
        price = meta.get("regularMarketPrice") or meta.get("preMarketPrice")
        prev = meta.get("chartPreviousClose") or meta.get("regularMarketPreviousClose")
        change_pct = pct(price, prev) if price and prev else 0
        broader_data[ticker] = {"price": price, "change_pct": change_pct}
        lines.append(f"  {ticker:8s}  ${price:>10.2f}  {change_pct:+.2f}%")
    else:
        lines.append(f"  {ticker:8s}  [fetch error]")
lines.append("")

# Tape read
es_chg = broader_data.get("ES=F", {}).get("change_pct", 0)
vix = broader_data.get("^VIX", {}).get("price", 0)
nq_chg = broader_data.get("NQ=F", {}).get("change_pct", 0)
if es_chg > 0.5 and nq_chg > 0.5:
    tone = f"Futures are constructive -- S&P +{es_chg:.1f}%, Nasdaq +{nq_chg:.1f}%. Risk appetite is elevated heading into the open."
elif es_chg < -0.5:
    tone = f"Futures are weak -- S&P {es_chg:.1f}%. Caution warranted; watch for further deterioration at the open."
else:
    tone = f"Futures are mixed/flat -- S&P {es_chg:+.1f}%, Nasdaq {nq_chg:+.1f}%. Indecisive tape."
if vix > 20:
    tone += f" VIX at {vix:.1f} signals elevated volatility -- size accordingly."
else:
    tone += f" VIX at {vix:.1f} is benign."
lines.append(tone)
lines.append("")

# Section 2: WATCHLIST
lines.append("=" * 60)
lines.append("SECTION 2 -- WATCHLIST")
lines.append("=" * 60)
ticker_data = {}
for ticker in WATCHLIST:
    meta = get_quote(ticker)
    time.sleep(0.3)
    if not meta:
        lines.append(f"  {ticker}: [fetch error]")
        continue
    price = meta.get("preMarketPrice") or meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("regularMarketPreviousClose", 0)
    is_pm = bool(meta.get("preMarketPrice"))
    chg = pct(price, prev)
    arrow = "▲" if chg >= 0 else "▼"
    pm_tag = " [PM]" if is_pm else ""
    lines.append(f"  {ticker:6s}{pm_tag:5s}  ${price:.2f}  {arrow} {abs(chg):.2f}%")
    news = get_news(ticker)
    time.sleep(0.3)
    for h in news:
        lines.append(f"    - {h}")
    ticker_data[ticker] = {"price": price, "prev": prev, "chg": chg}
lines.append("")

# Section 3: FUND MANAGER CALLS
lines.append("=" * 60)
lines.append("SECTION 3 -- FUND MANAGER CALLS")
lines.append("=" * 60)
for ticker in WATCHLIST:
    if ticker not in ticker_data:
        continue
    d = ticker_data[ticker]
    price = d["price"]
    prev = d["prev"]
    closes = get_history(ticker)
    time.sleep(0.3)
    rsi = calc_rsi(closes) if closes else None
    ma20 = sma(closes, 20)
    ma50 = sma(closes, 50)
    chg = d["chg"]

    call = None
    reason = ""

    dist_ma20 = pct(price, ma20) if ma20 else 0
    dist_ma50 = pct(price, ma50) if ma50 else 0

    if rsi and rsi > 75 and dist_ma20 > 8:
        support = round(ma20 * 0.98, 2) if ma20 else round(price * 0.92, 2)
        call = f"TRIM 15-20% -- RSI {rsi:.0f}, extended {dist_ma20:.1f}% above 20d MA (${ma20:.2f}). Re-enter ${support:.2f}-${round(price * 0.95, 2):.2f} on pullback."
    elif rsi and rsi < 40 and dist_ma50 > -5:
        entry_low = round(price * 0.98, 2)
        entry_high = round(price * 1.01, 2)
        call = f"ADD on open / scale in ${entry_low:.2f}-${entry_high:.2f} -- RSI {rsi:.0f}, oversold with trend intact."
    elif chg < -4:
        call = f"REDUCE -- down {chg:.1f}% pre-market, reassess catalyst before adding."
    else:
        call = "HOLD -- no action."
        if rsi:
            reason = f" RSI {rsi:.0f}"
        if ma20:
            reason += f", {dist_ma20:+.1f}% vs 20d MA"
        call += reason

    lines.append(f"  {ticker:6s}  ${price:.2f}  {call}")
lines.append("")

# Section 4: NOTABLE
lines.append("=" * 60)
lines.append("SECTION 4 -- NOTABLE")
lines.append("=" * 60)
lines.append("  Check earnings calendar for today/tomorrow on watchlist names.")
lines.append("  Monitor macro: FOMC minutes, CPI, jobs data if scheduled.")
lines.append("")

email_body = "\n".join(lines)

# Send via Resend
payload = json.dumps({
    "from": "onboarding@resend.dev",
    "to": [TO_EMAIL],
    "subject": subject,
    "text": email_body
}).encode()

req = urllib.request.Request(
    "https://api.resend.com/emails",
    data=payload,
    headers={
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
    },
    method="POST"
)
with urllib.request.urlopen(req) as r:
    result = json.loads(r.read())
    print(f"Sent: {result}")

print(email_body)
