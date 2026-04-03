from __future__ import annotations

from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / 'index.html').resolve().as_uri()


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1600, 'height': 1200})
        page.goto(URL, wait_until='load', timeout=30000)
        page.wait_for_timeout(1000)
        slot_count = page.locator('[data-slot-uid]').count()
        status_text = page.locator('#statusText').inner_text()
        title = page.title()
        print({'title': title, 'slot_count': slot_count, 'status_text': status_text})
        browser.close()


if __name__ == '__main__':
    main()
