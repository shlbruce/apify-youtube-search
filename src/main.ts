import { Actor } from 'apify';
import { chromium } from 'playwright';

type VideoResult = { title: string; url: string };
type Input = { keywords: string[] };


const width = 2048;
const height = 1152;

async function main() {
    await Actor.init();
    const input = await Actor.getInput() as Input;
    const keywords: string[] = input?.keywords || [];

    //const browser = await chromium.launch({ headless: true });
    const browser = await chromium.launch({ headless: false, slowMo: 100, args: [`--window-size=${width},${height}`] });
    const context = await browser.newContext({
        viewport: { width, height }
    });
    const page = await context.newPage();

    const maxCount = 50; // <--- Change this to your preferred number

    for (const keyword of keywords) {
        try {
            const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`;
            await page.goto(url, { waitUntil: 'networkidle' });
            await page.waitForSelector('ytd-video-renderer', { timeout: 10000 });

            await page.waitForSelector('#filter-button', { timeout: 2000 }); // Wait until the button is visible
            await page.click('#filter-button'); // Click the button
            await page.waitForTimeout(3000); // Waits 10 seconds (10,000 milliseconds)

            // Wait for the filter menu to appear (replace parent selector if needed)
            await page.waitForSelector('div[title="Sort by upload date"]', { timeout: 2000 });

            // Click the "Upload date" filter label
            await page.click('div[title="Sort by upload date"]');
            await page.waitForTimeout(5000);


            // Use a Map to keep track of unique videos by URL
            const videoMap = new Map<string, VideoResult>();

            // Scroll and collect until maxCount unique videos is reached or no new appear
            let prevCount = 0;

            while (videoMap.size < maxCount) {
                // Extract video results on current page
                const results: VideoResult[] = await page.evaluate(() => {
                    const videos = Array.from(document.querySelectorAll('ytd-video-renderer'));
                    return videos.map((v) => {
                        const titleElem = v.querySelector('#video-title') as HTMLAnchorElement | null;
                        const title = titleElem && titleElem.textContent ? titleElem.textContent.trim() : '';
                        const url = titleElem && titleElem.getAttribute('href') ?
                            'https://www.youtube.com' + titleElem.getAttribute('href') : '';
                        return { title, url };
                    });
                });

                // Add unique videos to the map
                for (const video of results) {
                    if (video.url && !videoMap.has(video.url)) {
                        videoMap.set(video.url, video);
                    }
                }

                // Stop if we already reached enough unique videos
                if (videoMap.size >= maxCount) break;

                // Scroll down for more results
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight * 0.9);
                });
                await page.waitForTimeout(2000);

                // Break if no new unique videos were added after scroll (end of results)
                // can't do this, because page may contain more videos that are not shown, then after scrolling, no new videos are added
                //if (videoMap.size === prevCount) break;
                prevCount = videoMap.size;
            }

            // --- Build a queue of video links ---
            const detailQueue = Array.from(videoMap.values()).slice(0, maxCount);

            // --- Process detail pages one by one ---
            for (const video of detailQueue) {
                // Skip short URLs or ones missing ID
                const match = video.url.match(/v=([^&]+)/);
                const id = match ? match[1] : null;
                if (!id) continue;

                const videoPage = await context.newPage();
                await videoPage.goto(video.url, { waitUntil: 'domcontentloaded' });
                await videoPage.waitForTimeout(2500); // Let content load

                // Scrape details using page.evaluate for info you want
                const detail = await videoPage.evaluate(() => {
                    // Extract channel info and other elements
                    function getText(sel: string) {
                        const el = document.querySelector(sel);
                        return el ? el.textContent?.trim() : '';
                    }
                    function getAttr(sel: string, attr: string) {
                        const el = document.querySelector(sel);
                        return el ? (el as HTMLElement).getAttribute(attr) : '';
                    }

                    // Video data
                    const title = getText('h1.title yt-formatted-string');
                    const description = getText('#description yt-formatted-string') ||
                        getText('#description-inline-expander yt-formatted-string');
                    const channelName = getText('ytd-channel-name a');
                    const channelUrl = getAttr('ytd-channel-name a', 'href')
                        ? 'https://www.youtube.com' + getAttr('ytd-channel-name a', 'href')
                        : '';
                    const channelId = channelUrl.split('/').pop() || '';
                    // Stats

                    const viewStr = getText('.view-count') || getText('span.view-count');
                    const viewMatch = (viewStr ?? '').replace(/,/g, '').match(/([\d,]+)/);
                    const views = viewMatch ? parseInt(viewMatch[1], 10) : undefined;


                    const likesBtn = document.querySelector('ytd-toggle-button-renderer[is-icon-button][aria-pressed] #text') as HTMLElement;
                    const likes = likesBtn && likesBtn.innerText ? parseInt(likesBtn.innerText.replace(/,/g, ''), 10) : undefined;

                    const isLive = !!document.querySelector('ytd-badge-supported-renderer .badge-style-type-live-now');
                    const isPrivate = !!document.querySelector('ytd-privacy-badge-renderer');

                    // Thumbnails
                    const thumbUrl = getAttr('link[itemprop="thumbnailUrl"]', 'href') ||
                        (document.querySelector('meta[property="og:image"]') as HTMLMetaElement)?.content || '';

                    // Dates
                    const publishDate = getText('#info-strings yt-formatted-string') ||
                        (document.querySelector('meta[itemprop="datePublished"]') as HTMLMetaElement)?.content || '';

                    return {
                        type: 'video',
                        id: new URL(window.location.href).searchParams.get('v') || window.location.pathname.split('/').pop(),
                        title,
                        status: 'OK',
                        url: window.location.href,
                        description,
                        views,
                        likes,
                        channel: {
                            id: channelId,
                            name: channelName,
                            url: channelUrl
                        },
                        isLive,
                        isPrivate,
                        thumbnails: thumbUrl
                            ? [{ url: thumbUrl, width: 1920, height: 1080 }]
                            : [],
                        publishDate
                    };
                });

                // Push result to dataset
                await Actor.pushData(detail);
                await videoPage.close();
            }
        }
        catch (err) {
            console.error(`Error while processing keyword "${keyword}":`, err);
            continue; // Skip this keyword if any error occurs
        }
    }

    await browser.close();
    await Actor.exit();
}

main().catch((err) => {
    console.error('Actor failed:', err);
    process.exit(1);
});
