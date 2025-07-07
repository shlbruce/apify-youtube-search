export function isYouTubeShortUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return u.hostname.endsWith('youtube.com') && u.pathname.startsWith('/shorts/');
    } catch {
        return false;
    }
}
