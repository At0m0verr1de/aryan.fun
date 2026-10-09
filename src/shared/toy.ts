// Every toy exports `meta` from src/toys/<slug>/meta.ts; the homepage is built from these.
export interface ToyMeta {
  slug: string;        // must match the route: src/pages/<slug>.astro
  title: string;
  accent: 'pink' | 'blue' | 'gold' | 'lilac' | 'mint'; // card colour, from theme.css
  blurb: string;       // one line on the homepage card
  added: string;       // YYYY-MM-DD, drives ordering and the "new" badge
  tags?: string[];
  hidden?: boolean;    // keep work-in-progress toys off the homepage
  couple?: boolean;    // partner-only: shown on the couple home, never in general mode
}
