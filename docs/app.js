/* =========================================================================
   RBI Digital Lending Apps — search & rendering logic
   One listing = one (entity, DLA) with N platform pills.
   Uses MiniSearch (UMD global) for full-text search.
   ========================================================================= */

(() => {
    "use strict";

    /* ----------------------------- State -------------------------------- */
    const state = {
        listings:    [],
        listingsById: new Map(),
        entitiesByName: new Map(),
        coLenderGroups: {},
        coLenderFilter: null,
        search:      null,
        filtered:    [],
        page:        0,
        pageSize:    30,
        lastQuery:   "",
        lastFilters: {},
        lastSort:    "relevance",
    };

    /* ----------------------------- DOM ---------------------------------- */
    const $ = (sel) => document.querySelector(sel);
    const els = {
        input:          $("#search-input"),
        clearBtn:       $("#search-clear"),
        filtersToggle:  $("#filters-toggle"),
        filtersCount:   $("#filters-count"),
        filtersPanel:   $("#filters"),
        filterType:     $("#filter-entity-type"),
        filterPlatform: $("#filter-platform"),
        filterTrust:    $("#filter-trust"),
        filterHealth:   $("#filter-health"),
        sortBy:         $("#sort-by"),
        resetBtn:       $("#reset-btn"),
        resultCount:    $("#result-count"),
        results:        $("#results"),
        loadMore:       $("#load-more"),
        empty:          $("#empty"),
        statListings:   $("#stat-listings"),
        statEntities:   $("#stat-entities"),
        statPlatforms:  $("#stat-platforms"),
        generatedAt:    $("#generated-at"),
        activeGroupPill:   $("#active-group-pill"),
        activeGroupLabel:  $("#active-group-label"),
        activeGroupClear:  $("#active-group-clear"),
        themeToggle:       $("#theme-toggle"),
    };

    /* ---------------------------- Theme --------------------------------- */
    function initTheme() {
        let stored = null;
        try { stored = localStorage.getItem("rbi-theme"); } catch (e) {}
        const initial = stored || "light";
        document.documentElement.setAttribute("data-theme", initial);
        if (els.themeToggle) {
            els.themeToggle.setAttribute("aria-pressed", String(initial === "dark"));
            els.themeToggle.addEventListener("click", () => {
                const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
                const next = cur === "dark" ? "light" : "dark";
                document.documentElement.setAttribute("data-theme", next);
                els.themeToggle.setAttribute("aria-pressed", String(next === "dark"));
                try { localStorage.setItem("rbi-theme", next); } catch (e) {}
            });
        }
    }

    /* --------------------------- Utilities ------------------------------ */
    function escapeHtml(str) {
        if (str === undefined || str === null) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /** Normalise a website value into a clickable absolute URL.
     *  Allows http(s)://… and the custom app-market schemes used by RBI data
     *  (oaps://, vivomarket://, market://). Bare hostnames like "foo.com" get
     *  upgraded to https://. Anything else returns "". */
    function toAbsoluteUrl(value) {
        if (!value) return "";
        const trimmed = String(value).trim();
        if (!trimmed) return "";
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^(oaps|vivomarket|market):\/\//i.test(trimmed)) return trimmed;
        if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)) {
            return "https://" + trimmed.replace(/^\/+/, "");
        }
        return "";
    }

    function highlight(text, tokens) {
        const safe = escapeHtml(text);
        if (!tokens || tokens.length === 0) return safe;
        const pattern = tokens
            .filter(Boolean)
            .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .filter((t) => t.length >= 2)
            .join("|");
        if (!pattern) return safe;
        try {
            const re = new RegExp(`(${pattern})`, "gi");
            return safe.replace(re, '<mark class="hl">$1</mark>');
        } catch {
            return safe;
        }
    }

    function debounce(fn, ms) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    function tokenize(q) {
        return q.toLowerCase().split(/[^a-z0-9._@-]+/).filter(Boolean);
    }

    /** Strip every character outside printable ASCII (0x20-0x7E). The data
     *  set is English-only, so any non-Latin code points in a query are
     *  either typos or an attempt to slip payloads past naive filters
     *  (homoglyph attacks, CJK / RTL / zero-width tricks, emoji-encoded
     *  shellcode, etc.). We also strip control chars (< 0x20) and DEL
     *  (0x7F) and hard-cap the length so a programmatic value-set cannot
     *  bypass the input element's maxlength attribute. Returns the cleaned
     *  string. */
    const NON_ASCII_RE = /[^\x20-\x7E]+/g;
    const MAX_QUERY_LEN = 200;
    function sanitizeAscii(s) {
        if (!s) return "";
        let out = String(s).replace(NON_ASCII_RE, "");
        if (out.length > MAX_QUERY_LEN) out = out.slice(0, MAX_QUERY_LEN);
        return out;
    }

    /* ---------------------- Platform icon mapping -----------------------
       Original geometric marks — abstract category cues, not brand-logo
       recreations. All inline SVG so the site works offline. */
    function svg(d, opts) {
        const sw = (opts && opts.sw) || 1.6;
        const vb = (opts && opts.vb) || "0 0 16 16";
        const f  = (opts && opts.f)  || "none";
        return `<svg viewBox="${vb}" aria-hidden="true" focusable="false"><path d="${d}" fill="${f}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    function svgFilled(d) {
        return `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${d}" fill="currentColor"/></svg>`;
    }
    function svgText(letters) {
        const fs = letters.length > 1 ? 8 : 10;
        const y  = letters.length > 1 ? 11 : 11.5;
        return `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><text x="8" y="${y}" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="${fs}" font-weight="800" fill="currentColor" letter-spacing="-0.2">${escapeHtml(letters)}</text></svg>`;
    }

    const PLATFORM_ICONS = {
        // Generic "play" triangle — universal media glyph, no brand colours.
        "Google Play Store":    svgFilled("M4.5 3.2v9.6c0 .5.55.8.98.55l7.7-4.8c.4-.25.4-.85 0-1.1L5.48 2.65c-.43-.25-.98.05-.98.55z"),
        // Abstract mono "phone-tile with download arrow" — category glyph, not the Apple mark.
        "Apple App Store":      svg("M8 3v6m0 0L5.5 6.5M8 9l2.5-2.5 M3.5 12.5h9"),
        // Letter tiles for the remaining stores — type, not logo.
        "Samsung Galaxy Store": svgText("S"),
        "Indus App Store":      svgText("In"),
        "Xiaomi GetApps":       svgText("Mi"),
        "Huawei AppGallery":    svgText("H"),
        "Vivo App Market":      svgText("V"),
        "OPPO App Market":      svgText("O"),
        // Globe — three meridians + equator.
        "Website":              svg("M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 0c-2 2-2 11 0 13M8 1.5c2 2 2 11 0 13M1.5 8h13"),
        // Three dots.
        "Other":                svgFilled("M3 8a1.4 1.4 0 100-2.8A1.4 1.4 0 003 8zm5 0a1.4 1.4 0 100-2.8A1.4 1.4 0 008 8zm5 0a1.4 1.4 0 100-2.8A1.4 1.4 0 0013 8z"),
    };

    const APP_STORE_PLATFORMS = new Set([
        "Google Play Store",
        "Apple App Store",
        "Samsung Galaxy Store",
        "Indus App Store",
        "Xiaomi GetApps",
        "Huawei AppGallery",
        "Vivo App Market",
        "OPPO App Market",
    ]);

    function platformShortLabel(p) {
        return {
            "Google Play Store":     "Play Store",
            "Apple App Store":       "App Store",
            "Samsung Galaxy Store":  "Galaxy",
            "Indus App Store":       "Indus",
            "Xiaomi GetApps":        "Xiaomi",
            "Huawei AppGallery":     "Huawei",
            "Vivo App Market":       "Vivo",
            "OPPO App Market":       "OPPO",
            "Website":               "Website",
            "Other":                 "Other",
        }[p] || p;
    }

    /* ------------------------- Filter population ------------------------ */
    function populateFilter(selectEl, values, formatter = (v) => v) {
        const existing = selectEl.querySelector('option[value=""]');
        selectEl.innerHTML = "";
        if (existing) selectEl.appendChild(existing);
        for (const v of values) {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = formatter(v);
            selectEl.appendChild(o);
        }
    }

    /* ---------------------------- Indexing ------------------------------ */
    function indexable(listing) {
        const platforms = listing.platforms.map((p) => p.platform).join(" ");
        const platformLinks = listing.platforms.map((p) => p.link).join(" ");
        const ci = listing.contact_info || {};
        return {
            id:               listing.id,
            entity_name:      listing.entity_name,
            entity_type:      listing.entity_type,
            entity_website:   listing.entity_website,
            dla_name:         listing.dla_name,
            dla_owner:        listing.dla_owner,
            officer_names:    listing.officer_names.join(" "),
            officer_emails:   listing.officer_emails.join(" "),
            officer_phones:   listing.officer_phones.join(" "),
            officer_mobiles:  listing.officer_mobiles.join(" "),
            package_names:    listing.package_names.join(" "),
            apple_app_ids:    listing.apple_app_ids.join(" "),
            platforms,
            platform_links:   platformLinks,
            trust_level:      listing.trust_level,
            dev_name:         ci.developer || "",
            dev_email:        ci.email || "",
            dev_phone:        ci.phone || "",
            dev_website:      ci.website || "",
            dev_address:      ci.address || "",
        };
    }

    function buildIndex() {
        const ms = new MiniSearch({
            idField: "id",
            fields: [
                "entity_name", "dla_name", "dla_owner",
                "officer_names", "officer_emails", "officer_phones", "officer_mobiles",
                "package_names", "apple_app_ids",
                "platforms", "platform_links",
                "entity_website",
                "trust_level",
                "dev_name", "dev_email", "dev_phone", "dev_website", "dev_address",
            ],
            storeFields: ["id"],
            searchOptions: {
                boost:    { dla_name: 5, entity_name: 3, dla_owner: 2, dev_name: 2 },
                prefix:   true,
                fuzzy:    0.15,
                combineWith: "AND",
            },
        });
        ms.addAll(state.listings.map(indexable));
        return ms;
    }

    /* ------------------------------ Query ------------------------------- */
    function currentFilters() {
        return {
            entity_type: els.filterType.value,
            platform:    els.filterPlatform.value,
            trust_level: els.filterTrust.value,
            health:      els.filterHealth.value,
        };
    }

    function listingHasBroken(r) {
        return r.platforms.some((p) =>
            APP_STORE_PLATFORMS.has(p.platform) &&
            (p.health && (p.health.status === "broken" || p.health.status === "error"))
        );
    }

    function listingAllAppStoreBroken(r) {
        const stores = r.platforms.filter((p) => APP_STORE_PLATFORMS.has(p.platform));
        if (stores.length === 0) return false;
        return stores.every((p) =>
            p.health && (p.health.status === "broken" || p.health.status === "error")
        );
    }

    function applyFilters(records, filters) {
        return records.filter((r) => {
            if (filters.entity_type && r.entity_type !== filters.entity_type) return false;
            if (filters.trust_level && r.trust_level !== filters.trust_level) return false;
            if (filters.platform) {
                const platSet = new Set(r.platforms.map((p) => p.platform));
                if (!platSet.has(filters.platform)) return false;
            }
            if (filters.health === "has_broken" && !listingHasBroken(r))         return false;
            if (filters.health === "all_broken" && !listingAllAppStoreBroken(r)) return false;
            if (filters.health === "all_ok"     && listingHasBroken(r))          return false;
            return true;
        });
    }

    function sortRecords(records, sortKey, hasQuery) {
        const sorted = records.slice();
        switch (sortKey) {
            case "entity_asc":
                sorted.sort((a, b) => a.entity_name.localeCompare(b.entity_name) ||
                                       a.dla_name.localeCompare(b.dla_name));
                break;
            case "entity_desc":
                sorted.sort((a, b) => b.entity_name.localeCompare(a.entity_name) ||
                                       a.dla_name.localeCompare(b.dla_name));
                break;
            case "dla_asc":
                sorted.sort((a, b) => (a.dla_name || "").localeCompare(b.dla_name || "") ||
                                       a.entity_name.localeCompare(b.entity_name));
                break;
            case "sr_no":
                sorted.sort((a, b) => a.first_sr_no - b.first_sr_no);
                break;
            case "risky_first":
                sorted.sort((a, b) => {
                    const ra = a.trust_level === "Risky" ? 0 : 1;
                    const rb = b.trust_level === "Risky" ? 0 : 1;
                    if (ra !== rb) return ra - rb;
                    return a.entity_name.localeCompare(b.entity_name);
                });
                break;
            case "relevance":
            default:
                if (!hasQuery) sorted.sort((a, b) => a.first_sr_no - b.first_sr_no);
                break;
        }
        return sorted;
    }

    function runSearch() {
        // Belt-and-braces: even if the input listener was bypassed (e.g. by
        // DevTools or a programmatic value set), drop anything outside
        // printable ASCII before it reaches MiniSearch.
        const q = sanitizeAscii(els.input.value).trim();
        const filters = currentFilters();
        const sortKey = els.sortBy.value;
        state.lastQuery   = q;
        state.lastFilters = filters;
        state.lastSort    = sortKey;
        els.clearBtn.hidden = q.length === 0;

        let candidates;
        if (state.coLenderFilter) {
            const group = state.coLenderGroups[state.coLenderFilter];
            if (group) {
                const ids = new Set(group.listing_ids);
                candidates = state.listings.filter((r) => ids.has(r.id));
                if (q.length > 0) {
                    const hits = state.search.search(q);
                    const hitIds = new Set(hits.map((h) => h.id));
                    candidates = candidates.filter((r) => hitIds.has(r.id));
                }
            } else {
                state.coLenderFilter = null;
                candidates = state.listings.slice();
            }
        } else if (q.length === 0) {
            candidates = state.listings.slice();
        } else {
            const hits = state.search.search(q);
            candidates = hits.map((h) => state.listingsById.get(h.id)).filter(Boolean);
        }
        candidates = applyFilters(candidates, filters);
        candidates = sortRecords(candidates, sortKey, q.length > 0);

        state.filtered = candidates;
        state.page = 0;
        updateActiveGroupPill();
        updateFiltersCount();
        render();
    }

    function updateActiveGroupPill() {
        const gid = state.coLenderFilter;
        if (!gid || !state.coLenderGroups[gid]) {
            els.activeGroupPill.hidden = true;
            return;
        }
        const g = state.coLenderGroups[gid];
        els.activeGroupLabel.textContent =
            `Co-lender group: "${g.dla_label}" by ${g.owner_label} (${g.entity_count} REs)`;
        els.activeGroupPill.hidden = false;
    }

    function updateFiltersCount() {
        if (!els.filtersCount) return;
        const f = state.lastFilters || {};
        const n = ["entity_type", "platform", "trust_level", "health"]
            .filter((k) => f[k]).length;
        if (n > 0) {
            els.filtersCount.textContent = String(n);
            els.filtersCount.hidden = false;
        } else {
            els.filtersCount.hidden = true;
        }
    }

    /* ----------------------------- Render ------------------------------- */
    function render() {
        const total = state.filtered.length;
        const tokens = tokenize(state.lastQuery);
        const end   = Math.min((state.page + 1) * state.pageSize, total);
        const slice = state.filtered.slice(0, end);

        els.empty.hidden = total > 0;
        els.results.setAttribute("aria-busy", "true");
        els.results.innerHTML = slice.map((r) => renderCard(r, tokens)).join("");
        els.results.setAttribute("aria-busy", "false");

        const filterDescription = describeFilters();
        if (total === 0) {
            els.resultCount.textContent =
                `0 listings match "${state.lastQuery}"${filterDescription}`;
        } else {
            els.resultCount.textContent =
                `Showing ${end.toLocaleString()} of ${total.toLocaleString()} listings` +
                (state.lastQuery ? ` for "${state.lastQuery}"` : "") +
                filterDescription;
        }
        els.loadMore.hidden = end >= total;
    }

    function describeFilters() {
        const parts = [];
        const f = state.lastFilters;
        if (f.entity_type) parts.push(`type=${f.entity_type}`);
        if (f.platform)    parts.push(`platform=${f.platform}`);
        if (f.trust_level) parts.push(`trust=${f.trust_level}`);
        if (f.health)      parts.push(`health=${f.health}`);
        return parts.length ? ` (filters: ${parts.join(", ")})` : "";
    }

    /** Display-only formatter for entity types.
     *  NBFC stays uppercase; everything else becomes Title Case. */
    function formatEntityType(t) {
        if (!t) return "";
        if (String(t).toUpperCase() === "NBFC") return "NBFC";
        return String(t).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
    }

    function typeBadge(t) {
        if (!t) return "";
        return `<span class="badge badge-type" data-type="${escapeHtml(t)}">${escapeHtml(formatEntityType(t))}</span>`;
    }

    /** Small "{age} yrs ({year})" badge, only shown for NBFC entities that
     *  successfully matched the data.gov.in MCA registry. Tooltip carries
     *  the precise incorporation date. */
    function ageBadge(r) {
        if (r.entity_type !== "NBFC") return "";
        const ci = r.company_info;
        if (!ci || !ci.incorp_year) return "";
        const year = String(ci.incorp_year).replace(/[^0-9]/g, "").slice(0, 4);
        if (!year) return "";
        const ageY = (ci.age_years != null) ? Math.floor(ci.age_years) : null;
        const text = ageY != null ? `${ageY} yrs (${year})` : `(${year})`;
        const tip  = ci.incorp_date ? `Incorporated ${ci.incorp_date}` : "";
        return `<span class="badge badge-age" title="${escapeHtml(tip)}">${escapeHtml(text)}</span>`;
    }

    /** Trust mark shown in the card-meta row.
     *  - "CoR Cancelled": the RBI cancelled this NBFC's Certificate of
     *    Registration (factual, strongest signal) -> solid-red badge whose
     *    tooltip cites the RBI press release / circular, the cancellation
     *    date and the CoR number.
     *  - "Risky": advisory flag -> red triangle badge.
     *  Anything else renders nothing. */
    function trustMark(r) {
        if (r.trust_level === "CoR Cancelled") {
            const cc = r.cor_cancelled || {};
            const banSign =
                `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.6 3.6l8.8 8.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
            const tipParts = [
                "Registration cancelled by RBI \u2014 this entity may no longer carry on the business of an NBFC.",
                cc.cor_cancelled ? `CoR cancelled on ${cc.cor_cancelled}` : "",
                cc.cor_no ? `CoR No. ${cc.cor_no}` : "",
                cc.source ? `Source: ${cc.source}` : "Source: RBI press release",
            ].filter(Boolean);
            return `<span class="risk-mark is-cancelled" role="note" title="${escapeHtml(tipParts.join(" \u00b7 "))}">${banSign} CoR Cancelled</span>`;
        }
        if (r.trust_level === "Risky") {
            return `<span class="risk-mark" role="note"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5L15 14H1L8 1.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.5M8 11.5v0.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Risky</span>`;
        }
        return "";
    }

    function pillIconHtml(platformName) {
        const icon = PLATFORM_ICONS[platformName] || PLATFORM_ICONS["Other"];
        return `<span class="pill-icon" data-platform="${escapeHtml(platformName)}" aria-hidden="true">${icon}</span>`;
    }

    function platformPill(p, tokens) {
        const label = platformShortLabel(p.platform);
        const href = toAbsoluteUrl(p.link);

        // Pills no longer surface a "broken" visual state. HTTP-based health
        // checks proved unreliable even for app-store URLs - some flagged as
        // broken actually load fine in a real browser - so all pills render
        // uniformly and let the user click through to verify.
        let pillCls = "platform-pill";
        let title;
        if (!href) {
            pillCls += " is-disabled";
            title = `${p.platform} — no URL listed`;
        } else {
            title = p.platform;
        }

        const inner =
            pillIconHtml(p.platform) +
            `<span class="pill-label">${highlight(label, tokens)}</span>`;

        const titleAttr = `title="${escapeHtml(title)}"`;
        if (href) {
            return `<a class="${pillCls}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" ${titleAttr}>${inner}</a>`;
        }
        return `<span class="${pillCls}" ${titleAttr}>${inner}</span>`;
    }

    /** Dedicated card for an RBI cancelled-CoR NBFC (no app, no officers) -
     *  shows the cancellation facts and a red badge whose tooltip cites the
     *  RBI press release. */
    function renderCancelledCard(r, tokens) {
        const cc = r.cor_cancelled || {};
        const safeId = Number(r.id) || 0;
        const rows = [];
        if (cc.cor_no)        rows.push(["CoR No.",   cc.cor_no]);
        if (cc.cor_cancelled) rows.push(["Cancelled", cc.cor_cancelled]);
        if (cc.cor_issued)    rows.push(["Issued",    cc.cor_issued]);
        if (cc.state)         rows.push(["Registered", cc.state]);
        if (cc.source)        rows.push(["Source",    cc.source]);
        const grid = rows.map(([k, v]) =>
            `<dt>${escapeHtml(k)}</dt><dd>${highlight(String(v), tokens)}</dd>`).join("");
        return `
        <article class="card is-cancelled" data-id="${safeId}">
            <div class="card-header">
                <div class="card-heading">
                    <h3 class="card-title">${highlight(r.dla_name || r.entity_name, tokens)}</h3>
                    <p class="card-subtitle">${highlight(r.entity_name, tokens)}</p>
                </div>
            </div>
            <div class="card-meta">
                ${typeBadge(r.entity_type)}
                ${trustMark(r)}
            </div>
            <div class="cancel-note" role="note">
                RBI cancelled this company&rsquo;s Certificate of Registration. It shall
                not transact the business of a Non-Banking Financial Institution.
            </div>
            <dl class="contact-grid cancel-grid">
                ${grid}
            </dl>
        </article>`;
    }

    function renderCard(r, tokens) {
        if (r.is_cancelled_entry) return renderCancelledCard(r, tokens);
        const riskyCls = r.trust_level === "Risky"         ? " is-risky"
                       : r.trust_level === "CoR Cancelled"  ? " is-cancelled"
                       : "";
        const dlaName  = r.dla_name || "(Unnamed app)";
        const webAbs   = toAbsoluteUrl(r.entity_website);
        // Entity website link — never decorated with a "broken" indicator,
        // because corporate sites often block bot UAs / geofence / are flaky.
        const webHtml  = webAbs
            ? `<a href="${escapeHtml(webAbs)}" target="_blank" rel="noopener noreferrer">${highlight(r.entity_website, tokens)}</a>`
            : (r.entity_website ? highlight(r.entity_website, tokens) : "<em class='dim'>none listed</em>");

        const platforms = r.platforms.length
            ? r.platforms.map((p) => platformPill(p, tokens)).join("")
            : `<span class="platform-pill is-disabled">${pillIconHtml("Other")}<span class="pill-label">No listing link</span></span>`;

        const riskyMark = trustMark(r);

        // Defence-in-depth: cast every numeric field to Number() before
        // string interpolation so a poisoned apps.json cannot smuggle HTML
        // through a field we currently expect to be an integer.
        const safeCoCount = Number(r.co_lender_count) || 0;
        const safeFirstSr = Number(r.first_sr_no) || 0;
        const safeRowCount = Array.isArray(r.sr_nos) ? r.sr_nos.length | 0 : 0;
        const safeId = Number(r.id) || 0;

        const coLenderChip = safeCoCount > 0
            ? `<button type="button" class="co-lender-chip" data-co-group="${escapeHtml(r.co_lender_group)}" title="Show all regulated entities listing this app">
                   <svg viewBox="0 0 16 16" aria-hidden="true" width="12" height="12"><path d="M6 10l-2 2a2.5 2.5 0 01-3.5-3.5l3-3a2.5 2.5 0 013.5 0M10 6l2-2a2.5 2.5 0 013.5 3.5l-3 3a2.5 2.5 0 01-3.5 0" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
                   Also used by ${safeCoCount} other RE${safeCoCount === 1 ? "" : "s"}
               </button>`
            : "";

        const officerBlock = renderOfficerBlock(r, tokens);
        const contactBlock = renderContactInfo(r.contact_info, tokens);

        const idTag = (safeRowCount > 1)
            ? `#${safeFirstSr} &middot; ${safeRowCount} source rows`
            : `#${safeFirstSr}`;

        return `
        <article class="card${riskyCls}" data-id="${safeId}">
            <div class="card-header">
                <div class="card-heading">
                    <h3 class="card-title">${highlight(dlaName, tokens)}</h3>
                    <p class="card-subtitle">${highlight(r.entity_name, tokens)}</p>
                </div>
            </div>

            <div class="card-meta">
                ${typeBadge(r.entity_type)}
                ${ageBadge(r)}
                ${riskyMark}
                <span class="id-tag">${idTag}</span>
            </div>

            <div class="kv-line">
                <span class="kv-key">Owner</span>
                <span class="kv-val">${highlight(r.dla_owner || "-", tokens)}</span>
            </div>
            <div class="kv-line">
                <span class="kv-key">Website</span>
                <span class="kv-val">${webHtml}</span>
            </div>

            <div class="platform-strip" aria-label="Available platforms">
                ${platforms}
            </div>

            ${coLenderChip}

            <div class="card-divider"></div>

            <details class="contact-toggle" open>
                <summary>Grievance Officer</summary>
                ${officerBlock}
            </details>

            ${contactBlock}
        </article>`;
    }

    function multiLineLinks(values, hrefBuilder, tokens) {
        if (!values.length) return "<span class='dim'>-</span>";
        return values
            .map((v) => `<a href="${escapeHtml(hrefBuilder(v))}">${highlight(v, tokens)}</a>`)
            .join("<br>");
    }
    function multiLineText(values, tokens) {
        if (!values.length) return "<span class='dim'>-</span>";
        return values.map((v) => highlight(v, tokens)).join("<br>");
    }

    function renderOfficerBlock(r, tokens) {
        return `
            <dl class="contact-grid">
                <dt>Name</dt>
                <dd>${multiLineText(r.officer_names, tokens)}</dd>
                <dt>Email</dt>
                <dd>${multiLineLinks(r.officer_emails, (v) => "mailto:" + v, tokens)}</dd>
                <dt>Phone</dt>
                <dd>${multiLineLinks(r.officer_phones, (v) => "tel:" + v, tokens)}</dd>
                <dt>Mobile</dt>
                <dd>${multiLineLinks(r.officer_mobiles, (v) => "tel:" + v, tokens)}</dd>
            </dl>`;
    }

    function renderContactInfo(c, tokens) {
        if (!c || (!c.developer && !c.email && !c.phone && !c.website && !c.address)) return "";
        const rows = [];
        if (c.developer) rows.push(["Developer", highlight(c.developer, tokens)]);
        if (c.email)     rows.push(["Email", `<a href="mailto:${escapeHtml(c.email)}">${highlight(c.email, tokens)}</a>`]);
        if (c.phone)     rows.push(["Phone", `<a href="tel:${escapeHtml(c.phone)}">${highlight(c.phone, tokens)}</a>`]);
        if (c.website)   {
            const abs = toAbsoluteUrl(c.website);
            rows.push(["Website", abs
                ? `<a href="${escapeHtml(abs)}" target="_blank" rel="noopener noreferrer">${highlight(c.website, tokens)}</a>`
                : highlight(c.website, tokens)]);
        }
        if (c.address)   rows.push(["Address", highlight(c.address, tokens)]);
        const sourceLabel = c.source || "Google Play";

        return `
            <details class="contact-toggle">
                <summary>Developer contact <span class="muted">from ${escapeHtml(sourceLabel)}</span></summary>
                <dl class="contact-grid">
                    ${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join("")}
                </dl>
            </details>`;
    }

    /* ----------------------------- Wiring ------------------------------- */
    function attachEvents() {
        // Synchronous strip BEFORE the debounced search fires. Anything outside
        // printable ASCII (CJK, RTL marks, zero-width chars, emoji, control
        // bytes) is removed while preserving cursor position where possible.
        els.input.addEventListener("input", () => {
            const v = els.input.value;
            const cleaned = sanitizeAscii(v);
            if (cleaned !== v) {
                const pos = Math.max(0, els.input.selectionStart - (v.length - cleaned.length));
                els.input.value = cleaned;
                try { els.input.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
            }
        });
        // Block beforeinput where the browser supports it - prevents the
        // non-ASCII char from ever appearing in the box on supported browsers.
        els.input.addEventListener("beforeinput", (e) => {
            if (typeof e.data === "string" && /[^\x20-\x7E]/.test(e.data)) {
                e.preventDefault();
            }
        });
        const onChange = debounce(runSearch, 160);
        els.input.addEventListener("input", onChange);
        els.filterType.addEventListener("change", runSearch);
        els.filterPlatform.addEventListener("change", runSearch);
        els.filterTrust.addEventListener("change", runSearch);
        els.filterHealth.addEventListener("change", runSearch);
        els.sortBy.addEventListener("change", runSearch);

        els.clearBtn.addEventListener("click", () => {
            els.input.value = "";
            els.input.focus();
            runSearch();
        });
        els.resetBtn.addEventListener("click", () => {
            els.input.value = "";
            els.filterType.value = "";
            els.filterPlatform.value = "";
            els.filterTrust.value = "";
            els.filterHealth.value = "";
            els.sortBy.value = "relevance";
            state.coLenderFilter = null;
            runSearch();
        });
        els.loadMore.addEventListener("click", () => {
            state.page += 1;
            render();
        });

        // Mobile filters sheet toggle.
        if (els.filtersToggle && els.filtersPanel) {
            els.filtersToggle.addEventListener("click", () => {
                const open = els.filtersPanel.classList.toggle("is-open");
                els.filtersToggle.setAttribute("aria-expanded", String(open));
            });
        }

        // Co-lender chip delegate.
        els.results.addEventListener("click", (e) => {
            const btn = e.target.closest(".co-lender-chip");
            if (!btn) return;
            const gid = btn.getAttribute("data-co-group");
            if (!gid || !state.coLenderGroups[gid]) return;
            state.coLenderFilter = gid;
            els.input.value = "";
            runSearch();
            window.scrollTo({ top: 0, behavior: "smooth" });
        });

        els.activeGroupClear.addEventListener("click", () => {
            state.coLenderFilter = null;
            runSearch();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "/" && document.activeElement !== els.input) {
                const tag = (document.activeElement && document.activeElement.tagName) || "";
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                e.preventDefault();
                els.input.focus();
                els.input.select();
            }
            if (e.key === "Escape" && document.activeElement === els.input && els.input.value) {
                els.input.value = "";
                runSearch();
            }
        });
    }

    /* ----------------------------- Bootstrap ---------------------------- */
    async function bootstrap() {
        try {
            const res = await fetch("data/apps.json", { cache: "no-cache" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            state.listings = data.listings;
            state.listings.forEach((r) => state.listingsById.set(r.id, r));
            if (Array.isArray(data.entities)) {
                data.entities.forEach((e) => state.entitiesByName.set(e.entity_name, e));
            }

            populateFilter(els.filterType,     data.meta.entity_types, formatEntityType);
            populateFilter(els.filterPlatform, data.meta.platforms);
            populateFilter(els.filterTrust,    data.meta.trust_levels,
                           (v) => v === "-" ? "Untagged" : v);

            els.statListings.textContent  = data.meta.total_listings.toLocaleString();
            els.statEntities.textContent  = data.meta.total_entities.toLocaleString();
            els.statPlatforms.textContent = data.meta.platforms.length.toString();
            state.coLenderGroups = data.meta.co_lender_groups || {};
            if (els.generatedAt) {
                els.generatedAt.textContent = data.meta.generated_at
                    ? data.meta.generated_at.replace("T", " ").replace("+00:00", " UTC")
                    : "unknown";
            }

            const t0 = performance.now();
            state.search = buildIndex();
            const t1 = performance.now();
            console.log(`Indexed ${state.listings.length} listings in ${(t1 - t0).toFixed(0)} ms`);

            attachEvents();
            initTheme();
            runSearch();
        } catch (err) {
            console.error(err);
            els.resultCount.textContent =
                "Failed to load data. Serve this folder via HTTP (e.g. `python -m http.server` in the web/ directory), not file://.";
        }
    }

    document.addEventListener("DOMContentLoaded", bootstrap);
})();
