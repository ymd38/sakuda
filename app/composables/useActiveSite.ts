// The site whose pages the header switcher should show as "current".
//
// `/sites/:id` and `/sites/:id/edit` carry the site id in the route, so the
// layout derives the active site from the route directly. `/scans/:id` does
// not — its route param is the scan id — so the scan page publishes the
// scan's siteId here once it has loaded, and the layout reads it back.
export const useActiveSiteId = () => useState<string | null>('active-site-id', () => null)
