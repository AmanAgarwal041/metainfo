"""MetaInfo scraper service, built on Scrapling (https://github.com/D4Vinci/Scrapling).

Two jobs the Cloudflare Worker can't do on its own:

* POST /render  render a page in headless Chromium (Scrapling's DynamicFetcher)
                and return the DOM after JavaScript, so the engine can measure
                what crawlers that don't run JS miss.
* POST /crawl   crawl a site (Scrapling's Spider): same host only, robots.txt
                obeyed, concurrency-limited, identified as MetaInfoBot. Returns
                each page's HTML for the WASM engine to audit, plus the sitemap
                URL list for coverage checks.

Deliberately not used: Scrapling's anti-bot features (StealthyFetcher,
Cloudflare challenge solving, TLS/browser fingerprint impersonation). This
service audits sites as an honest crawler.

Run:  uvicorn app:app --host 0.0.0.0 --port 8000
Env:  SCRAPER_TOKEN (require x-scraper-token), ALLOW_PRIVATE_HOSTS=1 (dev only)
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import socket
import time
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urldefrag, urljoin, urlsplit

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from scrapling.fetchers import AsyncDynamicSession, AsyncFetcher, FetcherSession
from scrapling.spiders import Request, Spider

UA = "Mozilla/5.0 (compatible; MetaInfoBot/1.0; +https://metainfo.agarwal-aman041.workers.dev)"
PAGE_HTML_CAP = 200_000
RENDER_HTML_CAP = 3_000_000
SITEMAP_URL_CAP = 5_000

# ------------------------------------------------------------------ guards


def _is_private(ip: str) -> bool:
    a = ipaddress.ip_address(ip)
    return a.is_private or a.is_loopback or a.is_link_local or a.is_multicast or a.is_reserved or a.is_unspecified


async def assert_public(url: str) -> None:
    """Refuse non-http(s) URLs and hosts that resolve to private networks (SSRF)."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise HTTPException(400, "Only http(s) URLs can be scanned.")
    if os.environ.get("ALLOW_PRIVATE_HOSTS") == "1":
        return
    host = parts.hostname
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    except socket.gaierror as e:
        raise HTTPException(400, f"Could not resolve {host}.") from e
    if any(_is_private(i[4][0]) for i in infos):
        raise HTTPException(400, "That host resolves to a private network address and can't be scanned.")


async def _block_private_subrequests(page: Any) -> None:
    """Playwright route guard: a rendered page may not load anything from private networks."""

    async def guard(route: Any) -> None:
        try:
            await assert_public(route.request.url)
        except HTTPException:
            return await route.abort()
        except Exception:
            return await route.abort()
        # fallback(), not continue_(): hand the request on to Scrapling's own
        # resource-blocking handler. continue_() raced it and stalled navigation.
        await route.fallback()

    if os.environ.get("ALLOW_PRIVATE_HOSTS") != "1":
        await page.route(re.compile(r"^https?://"), guard)


def check_token(x_scraper_token: str | None = Header(default=None)) -> None:
    want = os.environ.get("SCRAPER_TOKEN")
    if want and x_scraper_token != want:
        raise HTTPException(401, "Missing or wrong x-scraper-token.")


def normalize(url: str) -> str:
    return urldefrag(url)[0]


# ------------------------------------------------------------------ app

browser: AsyncDynamicSession | None = None
render_slots = asyncio.Semaphore(int(os.environ.get("RENDER_CONCURRENCY", "4")))
crawl_slots = asyncio.Semaphore(int(os.environ.get("CRAWL_CONCURRENCY", "2")))


@asynccontextmanager
async def lifespan(_: FastAPI):
    """One long-lived headless browser: launching Chromium per request costs ~20 s."""
    global browser
    browser = AsyncDynamicSession(
        headless=True,
        disable_resources=True,  # skip images, fonts, media: we need the DOM, not pixels
        google_search=False,  # no fake "came from Google" referer
        network_idle=True,
        timeout=12_000,
        max_pages=int(os.environ.get("RENDER_CONCURRENCY", "4")),
        useragent=UA,
        page_setup=_block_private_subrequests,
        retries=1,  # /render has its own fallback; Scrapling's default 3 retries blew the time budget
    )
    await browser.__aenter__()
    try:
        yield
    finally:
        await browser.__aexit__(None, None, None)


app = FastAPI(title="MetaInfo scraper (Scrapling)", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    import scrapling

    return {"ok": True, "scrapling": scrapling.__version__}


class RenderBody(BaseModel):
    url: str


@app.post("/render", dependencies=[Depends(check_token)])
async def render(body: RenderBody) -> dict[str, Any]:
    await assert_public(body.url)
    assert browser is not None
    async with render_slots:
        t0 = time.perf_counter()
        landed: dict[str, str] = {}

        async def note_url(pw_page: Any) -> Any:
            # Response.url is the requested URL; the page's own URL reveals
            # client-side (meta refresh / JavaScript) redirects.
            landed["url"] = pw_page.url
            return pw_page

        try:
            page = await browser.fetch(body.url, page_action=note_url)
        except Exception:  # noqa: BLE001
            # Some pages never reach network idle (polling, analytics beacons):
            # take the DOM shortly after load instead of waiting for the timeout.
            try:
                page = await browser.fetch(body.url, network_idle=False, wait=2500, timeout=15_000, page_action=note_url)
            except Exception as e:  # noqa: BLE001 - surface the reason to the caller
                raise HTTPException(502, f"Render failed: {e}") from e
        ms = round((time.perf_counter() - t0) * 1000)
    final_url = landed.get("url") or str(page.url)
    await assert_public(final_url)  # don't return content from a redirect into a private network
    html = str(page.html_content)
    return {
        "url": body.url,
        "finalUrl": final_url,
        "status": page.status,
        "html": html[:RENDER_HTML_CAP],
        "truncated": len(html) > RENDER_HTML_CAP,
        "renderMs": ms,
    }


class CrawlBody(BaseModel):
    url: str
    maxPages: int = Field(default=50, ge=1, le=200)
    maxDepth: int = Field(default=4, ge=0, le=6)


LOC_RE = re.compile(r"<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*</loc>")


async def sitemap_urls(origin: str) -> list[str]:
    """URLs listed in the site's sitemaps (robots.txt Sitemap lines, else /sitemap.xml)."""
    out: list[str] = []
    try:
        robots = await AsyncFetcher.get(origin + "/robots.txt", timeout=10, impersonate=None, stealthy_headers=False, headers={"User-Agent": UA})
        maps = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", robots.body.decode("utf-8", "replace")) if robots.status == 200 else []
    except Exception:  # noqa: BLE001
        maps = []
    queue = maps[:3] or [origin + "/sitemap.xml"]
    seen: set[str] = set()
    while queue and len(out) < SITEMAP_URL_CAP and len(seen) < 8:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        try:
            await assert_public(sm)
            r = await AsyncFetcher.get(sm, timeout=15, impersonate=None, stealthy_headers=False, headers={"User-Agent": UA})
        except Exception:  # noqa: BLE001
            continue
        if r.status != 200:
            continue
        text = r.body[:8_000_000].decode("utf-8", "replace")
        locs = [m.replace("&amp;", "&") for m in LOC_RE.findall(text)]
        if "<sitemapindex" in text:
            queue.extend(locs[:5])
        else:
            out.extend(locs[: SITEMAP_URL_CAP - len(out)])
    return out


@app.post("/crawl", dependencies=[Depends(check_token)])
async def crawl(body: CrawlBody) -> dict[str, Any]:
    await assert_public(body.url)
    start = normalize(body.url)
    host = urlsplit(start).hostname or ""
    origin = f"{urlsplit(start).scheme}://{urlsplit(start).netloc}"
    max_pages, max_depth = body.maxPages, body.maxDepth

    pages: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    queued: set[str] = {start}

    class SiteSpider(Spider):
        name = "metainfo"
        start_urls = [start]
        allowed_domains = {host}
        robots_txt_obey = True
        concurrent_requests = 8
        concurrent_requests_per_domain = 4
        logging_level = 40  # errors only

        def configure_sessions(self, manager: Any) -> None:
            # An honest crawler: no TLS impersonation, no stealth headers.
            manager.add(
                "default",
                FetcherSession(impersonate=None, stealthy_headers=False, headers={"User-Agent": UA}, timeout=20, follow_redirects=True, retries=1),
                default=True,
            )

        async def start_requests(self):  # type: ignore[override]
            yield Request(start, meta={"depth": 0, "from": None})

        async def parse(self, response: Any):  # type: ignore[override]
            meta = response.meta or {}
            depth = int(meta.get("depth", 0))
            req_url = normalize(str(response.request.url)) if getattr(response, "request", None) else normalize(str(response.url))
            final = normalize(str(response.url))
            ctype = str(dict(response.headers).get("content-type", ""))
            links: list[str] = []
            if "html" in ctype or not ctype:
                for href in response.css("a::attr(href), area::attr(href)").getall():
                    href = str(href).strip()
                    if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                        continue
                    absolute = normalize(urljoin(final, href))
                    if urlsplit(absolute).hostname == host and urlsplit(absolute).scheme in ("http", "https"):
                        links.append(absolute)
            links = list(dict.fromkeys(links))[:300]
            html = response.body[:PAGE_HTML_CAP].decode(response.encoding or "utf-8", "replace") if "html" in ctype or not ctype else ""
            pages.append({
                "url": req_url,
                "finalUrl": final,
                "status": response.status,
                "depth": depth,
                "from": meta.get("from"),
                # Scrapling's response doesn't expose fetch time, and timing from enqueue would
                # include queue wait, so no per-page time is reported for this crawler.
                "ms": None,
                "contentType": ctype,
                "headers": {k.lower(): str(v) for k, v in dict(response.headers).items()},
                "html": html,
                "truncated": len(response.body) > PAGE_HTML_CAP,
                "links": links,
            })
            if depth >= max_depth:
                return
            for link in links:
                if link in queued or len(queued) >= max_pages:
                    continue
                queued.add(link)
                yield response.follow(link, meta={"depth": depth + 1, "from": final})

        async def on_error(self, request: Any, error: Exception) -> None:  # type: ignore[override]
            errors.append({"url": normalize(str(request.url)), "error": str(error)[:200], "from": (request.meta or {}).get("from")})

    async with crawl_slots:
        t0 = time.perf_counter()
        spider = SiteSpider()
        sm_task = asyncio.create_task(sitemap_urls(origin))
        async for _ in spider.stream():
            pass
        sitemap = await sm_task
        ms = round((time.perf_counter() - t0) * 1000)

    crawled = {p["url"] for p in pages} | {e["url"] for e in errors}
    skipped = sorted(queued - crawled)  # queued but never fetched: disallowed by robots.txt
    return {
        "start": start,
        "pages": pages,
        "errors": errors,
        "robotsSkipped": skipped[:200],
        "sitemapUrls": sitemap,
        "crawlMs": ms,
        "limits": {"maxPages": max_pages, "maxDepth": max_depth},
    }
