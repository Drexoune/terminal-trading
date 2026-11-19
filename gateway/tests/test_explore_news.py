"""scripts/explore_news.py : lecture des flux et des messages, sans réseau.

Les fixtures reprennent la forme des vrais flux (RSS 2.0 de la Fed, dc:date seul
de la BNS, RDF de la Banque du Canada) : un parseur qui les lit mal donnerait
des délais faux pendant toute la mesure.
"""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("explore_news",
                                               ROOT / "scripts" / "explore_news.py")
news = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = news
_spec.loader.exec_module(news)

FED = b"""<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>FRB: Press Release - Monetary Policy</title>
<pubDate>Wed, 29 Jul 2026 18:00:00 GMT</pubDate>
<item><title>Federal Reserve issues FOMC statement</title>
<link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm</link>
<guid isPermaLink="true">https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm</guid>
<pubDate>Wed, 29 Jul 2026 18:00:00 GMT</pubDate></item>
<item><title>Minutes of the Federal Open Market Committee</title>
<link>https://www.federalreserve.gov/x.htm</link>
<pubDate>Wed, 08 Jul 2026 18:00:00 GMT</pubDate></item>
</channel></rss>"""

SNB = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<title>SNB press releases</title>
<item><title>Monetary policy assessment of 24 September 2026</title>
<link>https://www.snb.ch/en/publications/communication/press-releases/pre_20260924</link>
<dc:date>2026-09-24T09:30:00+02:00</dc:date></item>
</channel></rss>"""

BOC = """<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
 xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://www.bankofcanada.ca/"><title>Bank of Canada</title></channel>
<item rdf:about="https://www.bankofcanada.ca/2026/07/fad-press-release-2026-07-15/">
<title>Bank of Canada holds policy rate at 2¼%</title>
<link>https://www.bankofcanada.ca/2026/07/fad-press-release-2026-07-15/</link>
<dc:date>2026-07-15T05:47:46-04:00</dc:date></item>
</rdf:RDF>""".encode()


def test_rss2_fed_reads_items_and_rfc822_dates():
    s = news.summarize_feed(FED)
    assert (s["root"], s["version"], s["items"]) == ("rss", "2.0", 2)
    assert s["channel_pubdate"] == "Wed, 29 Jul 2026 18:00:00 GMT"
    first = s["sample"][0]
    assert first["title"] == "Federal Reserve issues FOMC statement"
    assert first["pub_ms"] == 1785348000000            # 29/07/2026 18:00 UTC
    assert first["guid"].endswith("monetary20260729a.htm")
    assert s["sample"][1]["guid"] is None


def test_snb_dc_date_only():
    item = news.summarize_feed(SNB)["sample"][0]
    assert item["pubDate"] is None
    assert item["dc_date"] == "2026-09-24T09:30:00+02:00"
    assert item["pub_ms"] == 1790235000000             # 07:30 UTC


def test_boc_rdf_keeps_unicode_title():
    s = news.summarize_feed(BOC)
    assert (s["root"], s["items"]) == ("RDF", 1)
    item = s["sample"][0]
    assert item["title"] == "Bank of Canada holds policy rate at 2¼%"
    assert item["link"].endswith("2026-07-15/")
    assert item["pub_ms"] == 1784108866000             # 09:47:46 UTC


def test_dates_without_timezone_are_refused():
    assert news._ms("2026-07-29T14:00:00") is None
    assert news._ms("Wed, 29 Jul 2026 18:00:00") is None
    assert news._ms("pas une date") is None
    assert news._ms(None) is None
    assert news._ms(" 2026-07-29T18:00:00Z ") == 1785348000000


def test_broken_feed_reports_parse_error():
    assert "parse_error" in news.summarize_feed(b"<rss><channel><item>")


def test_tree_messages():
    rec = news.tree_record('{"title":"FED CUTS RATES","time":1785348000000,"source":"X"}',
                           1785348000750)
    assert rec["label"] == "tree" and rec["lag_ms"] == 750
    assert rec["raw"]["title"] == "FED CUTS RATES"

    ping = news.tree_record(b"ping", 1)
    assert ping == {"label": "tree-text", "text": "ping", "t_recv_ms": 1}

    login = news.tree_record('{"user":{"username":"x","key":"secret"},"ok":true}', 2)
    assert login["label"] == "tree-login"
    assert login["raw"] == {"keys": ["ok", "user"]}    # rien du contenu n'est gardé

    other = news.tree_record("[1, 2]", 3)
    assert other["label"] == "tree-other"
    assert "lag_ms" not in news.tree_record('{"title":"x","time":12}', 4)


def test_lag_summary():
    assert news.describe_lags([]) is None
    d = news.describe_lags([900, 100, 300, 500, 700, 200, 400, 600, 800, 1000])
    assert d == {"n": 10, "min_ms": 100, "median_ms": 550, "p90_ms": 1000, "max_ms": 1000}
