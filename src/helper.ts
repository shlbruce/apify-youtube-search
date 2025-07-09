export function isYouTubeShortUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return u.hostname.endsWith('youtube.com') && u.pathname.startsWith('/shorts/');
    } catch {
        return false;
    }
}

// 7 months ago
// 1 year ago
// 13 days ago
// 1 day ago
// 2 weeks ago 
// 6 minutes ago
// 5 hours ago
export function timeAgoToMinutes(str: string): number | null {
    const regex = /(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i;
    const match = str.match(regex);
    if (!match) return null;
  
    const value = parseInt(match[1], 10);
    // This will always be one of the unit keys if the regex matched
    const unit = match[2].toLowerCase() as keyof typeof factors;
  
    // Conversion rates to minutes
    const factors = {
      minute: 1,
      hour: 60,
      day: 60 * 24,
      week: 60 * 24 * 7,
      month: 60 * 24 * 30,  // Approximate
      year: 60 * 24 * 365   // Approximate
    };
  
    return value * factors[unit];
  }

  export function isVideoAfter(specificDate: Date | undefined, timeAgoStr: string): boolean {
    if (!specificDate) {
        return true;
    }
    const minutesAgo = timeAgoToMinutes(timeAgoStr);
    if (minutesAgo === null) return true;

    const now = new Date();
    const minutesSinceSpecificDate = Math.floor((now.getTime() - specificDate.getTime()) / 60000);

    // If video was uploaded more recently than specificDate, return true
    return minutesAgo < minutesSinceSpecificDate;
}

