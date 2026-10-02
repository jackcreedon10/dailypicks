"""Build src/data/sp500.json: the S&P 500 companies used by Daily Tickr.

Sources: Wikipedia's "List of S&P 500 companies" (sector, industry, headquarters, founded) and
Nasdaq's stock screener (market cap, used to derive share counts so size can track live prices).

Run: python3 scripts/build-sp500.py
"""

import json
import re
import urllib.request
from html.parser import HTMLParser

UA_WIKI = "DailyTickr/1.0 (jackcreedon12@gmail.com)"
UA_BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"
OUT = "src/data/sp500.json"

# Second share classes of the same company: keep one ticker per company.
SKIP = {"GOOG", "FOX", "NWS"}

# Wikipedia gaps.
HQ_OVERRIDES = {"XYZ": "Oakland, California"}
# Wikipedia gives a merger or holding-company date where the familiar company is much older.
FOUNDED_OVERRIDES = {"XOM": "1870", "DELL": "1984", "CVS": "1963", "TPR": "1941", "RCL": "1968"}


def clean_name(name):
    """ "Walt Disney Company (The)" -> "The Walt Disney Company"; "Alphabet Inc. (Class A)" -> "Alphabet Inc." """
    name = re.sub(r"\s*\(Class [A-Z]\)$", "", name)
    m = re.match(r"^(.*) \(The\)$", name)
    return f"The {m.group(1)}" if m else name


def get(url, ua):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


class Table(HTMLParser):
    """Collects the first top-level table as rows of {text, href} cells."""

    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell, self.depth, self.done = [], None, None, 0, False

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.depth += 1
        if self.done or self.depth != 1:
            return
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = {"text": "", "href": None}
        elif tag == "a" and self.cell is not None and self.cell["href"] is None:
            self.cell["href"] = dict(attrs).get("href")

    def handle_endtag(self, tag):
        if tag == "table":
            if self.depth == 1:
                self.done = True
            self.depth -= 1
        if self.done:
            return
        if tag in ("td", "th") and self.cell is not None:
            self.cell["text"] = re.sub(r"\[\d+\]|\s+", " ", self.cell["text"]).strip()
            self.row.append(self.cell)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data


def main():
    wiki = get(
        "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies&prop=text&format=json&formatversion=2",
        UA_WIKI,
    )
    t = Table()
    t.feed(wiki["parse"]["text"])
    header = [c["text"] for c in t.rows[0]]
    assert header[:5] == ["Symbol", "Security", "GICS Sector", "GICS Sub-Industry", "Headquarters Location"], header
    assert header[-1] == "Founded", header

    screener = get("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true", UA_BROWSER)
    caps = {r["symbol"].replace("/", "."): r for r in screener["data"]["rows"]}

    out, missing = [], []
    for r in t.rows[1:]:
        sym = r[0]["text"]
        if sym in SKIP:
            continue
        q = caps.get(sym)
        try:
            cap, price = float(q["marketCap"]), float(q["lastsale"].lstrip("$"))
        except (TypeError, ValueError, KeyError):
            missing.append(sym)
            continue
        if not cap or not price:
            missing.append(sym)
            continue
        hq = HQ_OVERRIDES.get(sym, r[4]["text"])
        founded_text = FOUNDED_OVERRIDES.get(sym, r[-1]["text"])
        years = re.findall(r"\b(1[6-9]\d\d|20\d\d)\b", founded_text)
        out.append({
            "symbol": sym,
            "name": clean_name(r[1]["text"]),
            "wiki": (r[1]["href"] or "").removeprefix("/wiki/") or None,
            "sector": r[2]["text"],
            "industry": r[3]["text"],
            "hq": hq,
            "state": hq.split(",")[-1].strip(),
            "founded": int(years[0]) if years else None,
            "foundedText": founded_text,
            "shares": round(cap / price),
            "cap": round(cap),
        })

    out.sort(key=lambda c: -c["cap"])
    for i, c in enumerate(out):
        c["rank"] = i + 1
    with open(OUT, "w") as f:
        json.dump(out, f, indent=0, ensure_ascii=False)
    print(f"{len(out)} companies written to {OUT}; missing market cap: {missing}")


if __name__ == "__main__":
    main()
