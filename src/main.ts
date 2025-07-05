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

            // Prepare final results, limited to maxCount
            const uniqueVideos = Array.from(videoMap.values()).slice(0, maxCount);
            console.log(`Keyword: ${keyword} (${uniqueVideos.length} unique results)`);
            uniqueVideos.forEach((item, idx) => {
                console.log(`${idx + 1}. ${item.title} - ${item.url}`);
            });

            // Push only unique videos to dataset
            await Actor.pushData({ keyword, results: uniqueVideos });
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
