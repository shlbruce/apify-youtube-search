import { Actor } from 'apify';
import { chromium } from 'playwright';

type VideoResult = { title: string; url: string };
type Input = { keywords: string[] };

async function main() {
    await Actor.init(); // <-- FIRST!
    const input = await Actor.getInput() as Input;
    const keywords: string[] = input?.keywords || [];

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    for (const keyword of keywords) {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`;
        await page.goto(url, { waitUntil: 'networkidle' });

        await page.waitForSelector('ytd-video-renderer', { timeout: 10000 });

        const results: VideoResult[] = await page.evaluate(() => {
            const videos = Array.from(document.querySelectorAll('ytd-video-renderer')).slice(0, 10);
            return videos.map((v) => {
                const titleElem = v.querySelector('#video-title') as HTMLAnchorElement | null;
                const title = titleElem && titleElem.textContent ? titleElem.textContent.trim() : '';
                const url = titleElem && titleElem.getAttribute('href') ?
                    'https://www.youtube.com' + titleElem.getAttribute('href') : '';
                return { title, url };
            });
        });

        console.log(`Keyword: ${keyword}`);
        results.forEach((item, idx) => {
            console.log(`${idx + 1}. ${item.title} - ${item.url}`);
        });

        await Actor.pushData({ keyword, results });
    }

    await browser.close();
    await Actor.exit();
}

main().catch((err) => {
    console.error('Actor failed:', err);
    process.exit(1);
});
