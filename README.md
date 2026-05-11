# Digital Lending Apps — Lookup

A searchable, fully-static lookup of the **Reserve Bank of India's** public
list of *Digital Lending Apps used by Regulated Entities* (banks, NBFCs,
housing-finance companies).

> **Disclaimer.** This is an *unofficial* reformatting of the RBI dataset
> for easier search. Trust ratings, if any, are advisory only.


## Features

- 1,256 listings grouped from the RBI source (one card per *entity × DLA*
  rather than one card per platform).
- Cross-platform pills (Play Store, App Store, Samsung, Indus, Xiaomi, Huawei,
  Vivo, OPPO, Website) with publisher links.
- Grievance-officer contacts from the RBI sheet.
- Developer contacts enriched from public Google Play metadata.
- **Co-lender** chip — when a single product is co-lent by multiple regulated
  entities (e.g. one product under 12 REs), one click pivots to all siblings.
- Full-text search powered by [MiniSearch](https://github.com/lucaong/minisearch)
  (vendored locally — no CDNs at runtime).
- Light + Dark theme.

## Repository layout

```
.
├── docs/                     
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── security.js
│   ├── vendor/minisearch.js
│   └── data/apps.json
└── README.md
```

## Acknowledgements & citation

- **Data**: Reserve Bank of India — *List of Digital Lending Apps used by
  Regulated Entities*.
- **Search**: [MiniSearch](https://github.com/lucaong/minisearch) by Luca
  Ongaro, MIT.
- **Play Store metadata**: enriched from public store metadata.
