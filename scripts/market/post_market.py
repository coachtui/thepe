import urllib.request
import urllib.parse
import json
import time
import datetime
import os

RESEND_API_KEY = os.environ["RESEND_API_KEY"]
TO_EMAIL = "tui@tuialailima.com"

WATCHLIST = [
    "AMGN","AMZN","APLD","AXTI","BE","BRK-B","CLS","COHR","CRDO","CRWD",
    "FSLY","GOOGL","HOOD","IREN","LLY","MSFT","MU","NVDA","PLTR","QBTS",
    "SKM","SMH","TEM","TSM"
]
BROADER = ["SPY","QQQ","DIA","^VIX","^TNX","CL=F","GC=F"]

HEADERS = {"User-Agent": "Mozilla/5.0"}

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def get_quote(ticker):
    params = urllib.parse.urlencode({"interval": "1d", "range": "2d"})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?{params}"
    try:
        data = fetch(url)
        meta = data["chart"]["result"][0]["meta"]
        return meta
    except Exception:
        return None

def get_news(ticker):
    params = urllib.parse.urlencode({"q": ticker, "newsCount": "5", "quotesCount": "0"})
    url = f"https://query2.finance.yahoo.com/v1/finance/search?{params}"
    try:
        data = fetch(url)
        news = data.get("news", [])
        now = time.time()
        today_start = datetime.datetime.now().replace(hour=0, minute=0, second=0).timestamp()
        recent = [n["title"] for n in news if n.get("providerPublishTime", 0) >= today_start]
        return recent[:2]
    except Exception:
        return []

def pct(a, b):
    if not b or b == 0:
        return 0
    return (a - b) / b * 100

today = datetime.datetime.now()
subject = f"Market Close Review -- {today.strftime('%A %B %d, %Y')}"
lines = []

# Section 1: MARKET SUMMARY
lines.append("=" * 60)
lines.append("SECTION 1 -- MARKET SUMMARY")
lines.append("=" * 60)
broader_data = {}
for ticker in BROADER:
    meta = get_quote(ticker)
    time.sleep(0.3)
    if meta:
        price = meta.get("regularMarketPrice")
        prev = meta.get("chartPreviousClose") or meta.get("regularMarketPreviousClose", 0)
        chg = pct(price, prev)
        dollar_chg = (price - prev) if price and prev else 0
        arrow = "▲" if chg >= 0 else "▼"
        broader_data[ticker] = {"price": price, "chg": chg}
        lines.append(f"  {ticker:6s}  ${price:.2f}  {arrow} ${abs(dollar_chg):.2f}  ({chg:+.2f}%)")
    else:
        lines.append(f"  {ticker:6s}  [fetch error]")

spy_chg = broader_data.get("SPY", {}).get("chg", 0)
qqq_chg = broader_data.get("QQQ", {}).get("chg", 0)
vix = broader_data.get("^VIX", {}).get("price", 0)
lines.append("")
if spy_chg > 0.5:
    tone = f"Markets closed higher -- SPY {spy_chg:+.2f}%, QQQ {qqq_chg:+.2f}%. Risk-on tone with broad participation."
elif spy_chg < -0.5:
    tone = f"Markets sold off -- SPY {spy_chg:+.2f}%, QQQ {qqq_chg:+.2f}%. Risk-off session."
else:
    tone = f"Flat close -- SPY {spy_chg:+.2f}%, QQQ {qqq_chg:+.2f}%. Indecisive session."
if vix > 20:
    tone += f" VIX remains elevated at {vix:.1f}."
lines.append(tone)
lines.append("")

# Section 2: WATCHLIST MOVES
lines.append("=" * 60)
lines.append("SECTION 2 -- WATCHLIST -- TODAY'S MOVES")
lines.append("=" * 60)
moves = []
for ticker in WATCHLIST:
    meta = get_quote(ticker)
    time.sleep(0.3)
    if not meta:
        continue
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("regularMarketPreviousClose", 0)
    chg = pct(price, prev)
    dollar_chg = (price - prev) if price and prev else 0
    news = get_news(ticker)
    time.sleep(0.3)
    moves.append({"ticker": ticker, "price": price, "chg": chg, "dollar_chg": dollar_chg, "news": news})

moves.sort(key=lambda x: abs(x["chg"]), reverse=True)
for m in moves:
    arrow = "▲" if m["chg"] >= 0 else "▼"
    lines.append(f"  {m['ticker']:6s}  ${m['price']:.2f}  {arrow} ${abs(m['dollar_chg']):.2f}  ({m['chg']:+.2f}%)")
    for h in m["news"]:
        lines.append(f"    - {h}")
lines.append("")

# Section 3: NOTABLE
lines.append("=" * 60)
lines.append("SECTION 3 -- NOTABLE")
lines.append("=" * 60)
lines.append("  Review earnings releases, analyst actions, and macro events for today.")
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
