# Product

## Register

product

## Users

TUS (Technological University of the Shannon) students searching for accommodation near the Moylish campus, Limerick. They're scanning a map/list under time pressure (often mid-search across several sites), filtering by price, bed count, and accommodation type to shortlist places worth contacting. Some users are low-vision and need larger text, strong contrast, and non-color-dependent cues.

## Product Purpose

Aggregates and geocodes TUS SU accommodation listings (scraped from tussu.ie, Moylish campus filter) onto a single interactive Leaflet map, so students don't have to manually cross-reference a paginated listings site against a mental map of the city. Success = a student can quickly see where listings are relative to campus, filter to what's relevant to them, and reach the original listing.

## Brand Personality

Clear, functional, no-nonsense. Information-dense but scannable — this is a utility, not a showcase. Trustworthy in the way a well-run university service page is trustworthy: plain, current, doesn't oversell.

## Anti-references

No strong opinion supplied; default to avoiding decorative/marketing-site flourishes (gradients, hero sections) since they'd work against the "get the job done fast" purpose.

## Design Principles

- Legibility over decoration — every visual choice should make listings faster to scan, not slower.
- Map and data are the interface; chrome (header, filter bar) stays out of the way.
- Never rely on color alone to convey meaning (type, price, status) — color is a reinforcement, not the only channel.
- Controls should be comfortably operable by low-vision and motor-impaired users: large hit targets, visible focus states, real contrast.

## Accessibility & Inclusion

Primary driver for the current work: low-vision users. Requirements — larger base/interactive text sizes, WCAG AA+ contrast throughout (header, filter bar, popups, legend), visible focus indicators on every interactive element, ARIA roles/labels on custom controls (checkboxes, sliders, refresh button, map region), and non-color differentiation for the four map marker types (shape/icon/pattern, not just hue) since color-only legends fail both low-vision and colorblind users.
