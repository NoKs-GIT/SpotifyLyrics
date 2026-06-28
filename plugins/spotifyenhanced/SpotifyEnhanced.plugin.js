/**
 * @name SpotifyEnhanced
 * @author noks.pm
 * @description Displays Spotify lyrics as your Discord custom status in real time.
 * @version 4.0.0
 */

module.exports = class SpotifyEnhanced {

    // ─── Constants ────────────────────────────────────────────────────────────

    // ─── Identity ─────────────────────────────────────────────────────────────
    static PLUGIN_NAME    = "SpotifyEnhanced";
    static PLUGIN_VERSION = "4.0.0";
    static PLUGIN_DESC    = "All-in-one Spotify enhancement suite for Discord";

    // Sub-plugins — single source of truth for name/version/desc
    static SUB_PLUGINS = {
        spotifylyrics: {
            key:     "spotifylyrics",
            name:    "SpotifyLyrics",
            version: "1.0.0",
            desc:    "Displays real-time Spotify lyrics as your Discord custom status",
            navLabel:"🎵 SpotifyLyrics",
        },
        spotifytitledisplay: {
            key:     "spotifytitledisplay",
            name:    "SpotifyTitleDisplay",
            version: "1.1.1",
            desc:    "Replaces artist name with song title on Spotify statuses",
            navLabel:"🎤 TitleDisplay",
        },
    };

    static LRCLIB_BASE    = "https://lrclib.net/api";
    static APPEAL_URL     = "https://support.discord.com/hc/en-us/requests/";
    static CACHE_MAX       = 15;
    static CACHE_TTL       = 30 * 60 * 1000;
    static INSTRUMENTAL_RE = /^[♪♫*\-~\s]+$/;
    static LOG_MAX         = 200;
    static HISTORY_DEFAULT = 20;
    static GLOBAL_LOGS     = [];  // cross-plugin log buffer (errors/warns/debug only)
    static GLOBAL_LOG_MAX  = 100;
    static PLUGIN_STATES   = {};   // { key: { mode, startedAt, stoppedAt } }
    // Plugin modes: "active" | "semi" | "disabled"
    static MODES = {
        active:   { label: "Active",      color: "#57f287", icon: "▶" },
        semi:     { label: "Semi-Active", color: "#fee75c", icon: "⏸" },
        disabled: { label: "Disabled",    color: "#ed4245", icon: "⏹" },
    };
    static MODE_DESC = {
        spotifylyrics: {
            active:   "Everything runs — Spotify scanning, lyrics loading, external requests (Spotify API + LRCLIB), Discord status updates.",
            semi:     "Everything runs except Discord status updates — Spotify scanning active, lyrics pre-loaded in background, external requests allowed, zero Discord API calls.",
            disabled: "Completely off — no scanning, no requests, no processing. Settings still accessible.",
        },
        spotifytitledisplay: {
            active:   "RPC patch active — song title replaces artist name on your Spotify status visible to other users.",
            semi:     "Patch installed in passthrough mode — ready to activate instantly, but output unchanged. Other users see normal artist names.",
            disabled: "Patch removed — completely off, no processing.",
        },
    };

    // ─── Log levels ───────────────────────────────────────────────────────────

    static LOG_LEVELS = {
        info:    { color: "#57f287", label: "INFO",    icon: "ℹ" },
        warn:    { color: "#fee75c", label: "WARN",    icon: "⚠" },
        error:   { color: "#ed4245", label: "ERROR",   icon: "✖" },
        debug:   { color: "#99aab5", label: "DEBUG",   icon: "🔍" },
        lyric:   { color: "#5865f2", label: "LYRIC",   icon: "🎵" },
        status:  { color: "#eb459e", label: "STATUS",  icon: "💬" },
        cache:   { color: "#faa61a", label: "CACHE",   icon: "📦" },
        network: { color: "#00b0f4", label: "NET",     icon: "🌐" },
        spotify: { color: "#1db954", label: "SPOTIFY", icon: "🎧" },
        preset:  { color: "#ff73fa", label: "PRESET",  icon: "⚡" },
        plugin:  { color: "#e67e22", label: "PLUGIN",  icon: "🔌" },
    };

    // ─── Presets ──────────────────────────────────────────────────────────────

    static PRESETS = {
        safe: {
            label:                "🛡️ Safe",
            description:          "Slow polling, minimal Discord API calls. Best if you want maximum discretion.",
            pollInterval:         2000,
            statusUpdateThrottle: 3000,
            queuePrefetchDelay:   60000,
            lrclibTimeout:        15000,
            autoInstruGap:        8000,
            lyricsOffsetMs:       0,
            showRepeatCount:      true,
            lrclibFallbackSearch: true,
        },
        balanced: {
            label:                "⚖️ Balanced",
            description:          "Default settings. Good balance between reactivity and discretion. Recommended for most users.",
            pollInterval:         700,
            statusUpdateThrottle: 1000,
            queuePrefetchDelay:   30000,
            lrclibTimeout:        12000,
            autoInstruGap:        8000,
            lyricsOffsetMs:       0,
            showRepeatCount:      true,
            lrclibFallbackSearch: true,
        },
        realtime: {
            label:                "⚡ Real Time",
            description:          "Very fast polling, near-instant lyrics. Generates more internal traffic. Less discreet.",
            pollInterval:         300,
            statusUpdateThrottle: 350,
            queuePrefetchDelay:   15000,
            lrclibTimeout:        8000,
            autoInstruGap:        6000,
            lyricsOffsetMs:       0,
            showRepeatCount:      true,
            lrclibFallbackSearch: true,
        },
    };

    // ─── Defaults ─────────────────────────────────────────────────────────────

    static DEFAULTS = {
        preset:                    "balanced",
        // Display
        statusFormat:              "{lyric}",  // {emoji} is set separately as Discord emoji field
        statusEmoji:               "🎶",
        instrumentalText:          "♪ instru ♪",
        fallbackNoLyrics:          "track",    // "track" | "custom" | "none"
        fallbackCustomText:        "",
        showTrackNameBeforeLyrics: true,
        trackNameDuration:         5000,
        skipEmptyLines:            true,
        truncateLength:            128,
        showRepeatCount:           true,
        // Performance
        pollInterval:              700,
        statusUpdateThrottle:      1000,
        queuePrefetchDelay:        30000,
        lrclibTimeout:             12000,
        // Advanced
        lrclibFallbackSearch:      true,
        lyricsOffsetMs:            0,
        autoInstruGap:             8000,
        // Schedule
        scheduleEnabled:           false,
        scheduleFrom:              "08:00",
        scheduleTo:                "23:00",
        // Protection
        dndProtect:                false,
        // Mode
        lyricsOnlyMode:            false,
        // Track offsets (per-track, stored separately)
        // Blacklist (stored separately)
        // History
        historyEnabled:            true,
        historyMax:                20,
        // Export/Import handled at runtime
        // Debug
        debugLogs:                 false,
        logFilter:                 "all",  // "all" | specific level
    };

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        // Poll
        this._pollTimer           = null;
        // Track state
        this._currentTrackId      = null;
        this._currentLyrics       = null;
        this._lastDisplayedLine   = null;
        this._trackHeaderShown    = false;
        this._trackHeaderTimer    = null;
        this._isPlaying           = false;
        // Repeat
        this._repeatCount         = 0;
        this._repeatText          = null;
        // Instru
        this._autoInstruShown     = false;
        this._lastStatusUpdate    = 0;
        // Prefetch
        this._lastQueuePrefetch   = 0;
        this._lyricsCache         = new Map();  // trackId → { lyrics, cachedAt }
        this._prefetching         = new Set();
        // Status save/restore
        this._savedStatus         = null;
        this._statusSaved         = false;
        this._lastSentStatus      = null;
        this._enabled             = false;  // disabled by default until consent
        this._semiActive          = false;  // semi-active mode (local only)
        this._abortController     = null;   // AbortController for in-flight fetches
        this._consented           = {};     // { pluginKey: bool }
        // SpotifyTitleDisplay sub-plugin
        this._stdEnabled          = false;
        this._stdSemiActive       = false;
        this._stdShowArtist       = false;
        this._stdPatcher          = null;
        // Discord modules
        this._SpotifyStore        = null;
        this._UserSettingsUpdater = null;
        // Logs
        this._logs                = [];
        this._logPanel            = null;
        this._logFilterEl         = null;
        // History
        this._history             = [];         // { id, name, artist, at }
        // Per-track offsets & blacklist (persisted)
        this._trackOffsets        = {};         // trackId → ms
        this._blacklist           = new Set();  // trackId
        // Settings
        this._settings            = null;
        // Status refresh for "currently playing" status box
        this._statusRefreshTimer  = null;
    }

    // ─── Logging ──────────────────────────────────────────────────────────────

    _log(level, msg, extra) {
        const def   = SpotifyEnhanced.LOG_LEVELS[level] ?? SpotifyEnhanced.LOG_LEVELS.info;
        const entry = {
            ts:      Date.now(),
            time:    new Date().toLocaleTimeString("en-US", { hour12: false }),
            plugin:  (msg?.startsWith("[STD]") ? "SpotifyTitleDisplay" : "SpotifyLyrics"),
            level,
            icon:    def.icon,
            color:   def.color,
            msg,
            extra:   extra ?? null,
        };
        // Per-plugin log buffer
        this._logs.push(entry);
        if (this._logs.length > SpotifyEnhanced.LOG_MAX) this._logs.shift();
        if (this._logPanel) this._renderLogs();
        // Global log buffer — errors, warns, info, plugin events (no lyric/status/cache/network spam)
        if (["error", "warn", "info", "plugin"].includes(level)) {
            SpotifyEnhanced.GLOBAL_LOGS.push(entry);
            if (SpotifyEnhanced.GLOBAL_LOGS.length > SpotifyEnhanced.GLOBAL_LOG_MAX)
                SpotifyEnhanced.GLOBAL_LOGS.shift();
        }
        if (this._settings?.debugLogs) {
            const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.debug;
            fn(`[SpotifyEnhanced:SpotifyLyrics:${def.label}] ${msg}`, extra ?? "");
        }
    }

    _renderLogs() {
        if (!this._logPanel) return;
        const filter = this._settings?.logFilter ?? "all";
        const entries = this._logs
            .filter(e => filter === "all" || e.level === filter)
            .slice(-80)
            .reverse();

        if (!entries.length) {
            this._logPanel.innerHTML = `<div style="color:var(--text-muted);font-size:12px;font-style:italic;padding:8px">No logs${filter !== "all" ? ` for filter "${filter}"` : ""}</div>`;
            return;
        }

        this._logPanel.innerHTML = entries.map(e => `
            <div style="display:flex;gap:6px;align-items:baseline;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.04)">
                <span style="color:var(--text-muted);font-size:10px;flex-shrink:0;font-family:monospace">${e.time}</span>
                <span style="font-size:10px;flex-shrink:0">${e.icon}</span>
                <span style="font-size:10px;font-weight:700;color:${e.color};flex-shrink:0;min-width:46px">${SpotifyEnhanced.LOG_LEVELS[e.level]?.label ?? e.level}</span>
                <span style="font-size:11px;color:var(--text-normal);word-break:break-all">${e.msg.replace(/</g, "&lt;")}</span>
            </div>
        `).join("");
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start() {
        this._settings     = this._loadSettings();
        this._trackOffsets = BdApi.Data.load(SpotifyEnhanced.PLUGIN_NAME, "trackOffsets") ?? {};
        this._blacklist    = new Set(BdApi.Data.load(SpotifyEnhanced.PLUGIN_NAME, "blacklist") ?? []);
        this._history      = BdApi.Data.load(SpotifyEnhanced.PLUGIN_NAME, "history") ?? [];
        this._consented    = BdApi.Data.load(SpotifyEnhanced.PLUGIN_NAME, "consented") ?? {};

        // All plugins start DISABLED — user must explicitly consent + enable
        this._enabled    = false;
        this._stdEnabled = false;
        SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"]       = { mode: "disabled", startedAt: null, stoppedAt: null };
        SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"] = { mode: "disabled", startedAt: null, stoppedAt: null };

        this._resolveDiscordModules();
        const initial = this._readCurrentStatus();
        if (initial !== null) this._savedStatus = initial;

        this._log("info", `SpotifyEnhanced v${SpotifyEnhanced.PLUGIN_VERSION} started`);
        this._log("plugin", "SpotifyLyrics: INACTIVE — enable manually in Main > Plugins");
        this._log("plugin", "SpotifyTitleDisplay: INACTIVE — enable manually in Main > Plugins");
    }

    stop() {
        this._log("plugin", "SpotifyLyrics stopping...");
        this._log("plugin", "SpotifyTitleDisplay stopping...");
        this._stopPoll();
        this._stopSTD();
        if (this._trackHeaderTimer) clearTimeout(this._trackHeaderTimer);
        if (this._statusRefreshTimer) clearInterval(this._statusRefreshTimer);
        this._restoreStatus();
        this._log("info", `SpotifyEnhanced v${SpotifyEnhanced.PLUGIN_VERSION} stopped`);
        this._resetState();
    }

    // ─── SpotifyTitleDisplay sub-plugin ──────────────────────────────────────

    _startSTD() {
        if (this._stdSemiActive) {
            // Upgrade semi → active
            this._stdEnabled    = true;
            this._stdSemiActive = false;
            // Patcher already installed, just flip flag
            SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"].mode = "active";
            this._log("plugin", "[STD] SpotifyTitleDisplay upgraded semi → ACTIVE");
            return;
        }
        if (!this._stdEnabled) return;
        try {
            const ActivityTextModule = BdApi.Webpack.getModule(m =>
                Object.values(m).some(v => typeof v === "function" && v.toString().includes("status_display_type"))
            );
            if (!ActivityTextModule) {
                this._log("warn", "[STD] ActivityTextModule not found — SpotifyTitleDisplay inactive");
                return;
            }
            const key = Object.keys(ActivityTextModule).find(k =>
                ActivityTextModule[k].toString().includes("status_display_type")
            );
            if (!key) {
                this._log("warn", "[STD] ActivityTextModule key not found");
                return;
            }
            // Store unpatch fn
            const origFn = ActivityTextModule[key];
            const self   = this;
            self._log("debug", `[STD] Patching key: "${key}" on ActivityTextModule`);
            ActivityTextModule[key] = function(...args) {
                const result   = origFn.apply(this, args);
                const activity = args[0];
                if (!activity || activity.type !== 2 || activity.name !== "Spotify") return result;
                if (!self._stdEnabled) return result;
                const title = activity.details;
                if (!title) { self._log("debug", "[STD] No title in activity — skipping"); return result; }
                const ss      = self._stdSettings ?? {};
                // Discord separates multiple artists with "; " in activity.state
                const allArts = (activity.state ?? "").split(/;\s*|,\s*/).map(a => a.trim()).filter(Boolean);
                const maxA    = parseInt(ss.maxArtists ?? 1, 10);
                const artists = (maxA >= 99 ? allArts : allArts.slice(0, maxA));
                const sep     = ss.separator ?? " — ";
                let display   = ss.showTitle !== false ? title : "";
                if (self._stdShowArtist && artists.length) {
                    if (display) display += sep;
                    display += artists.join(", ");
                }
                if (ss.showAlbum && activity.details) { /* album not in activity.state */ }
                display = (ss.prefix ?? "") + display + (ss.suffix ?? "");
                if (!display) return result;
                self._log("debug", `[STD] Display: "${display}" (artists: ${artists.join(", ")})`);
                return { ...result, text: display, tooltip: display };
            };
            this._stdPatcher = () => { ActivityTextModule[key] = origFn; };
            self._log("plugin", "[STD] SpotifyTitleDisplay started — patched ActivityTextModule");
        } catch(e) {
            this._log("error", `[STD] Failed to start: ${e.message}`);
        }
    }

    _semiSTD() {
        // Semi-active: patch is installed but passthrough — returns original result
        // The patch is "ready" but doesn't modify the output
        this._stopSTD(); // clean slate first
        this._stdSemiActive = true;
        this._stdEnabled    = false;
        // Install passthrough patch so it's "ready"
        try {
            const ActivityTextModule = BdApi.Webpack.getModule(m =>
                Object.values(m).some(v => typeof v === "function" && v.toString().includes("status_display_type"))
            );
            if (ActivityTextModule) {
                const key = Object.keys(ActivityTextModule).find(k =>
                    ActivityTextModule[k].toString().includes("status_display_type")
                );
                if (key) {
                    const origFn = ActivityTextModule[key];
                    const self   = this;
                    ActivityTextModule[key] = function(...args) {
                        // Semi: always return original — plugin is "ready" but passive
                        if (!self._stdEnabled) return origFn.apply(this, args);
                        return origFn.apply(this, args); // also passthrough until activated
                    };
                    this._stdPatcher = () => { ActivityTextModule[key] = origFn; };
                    this._log("[STD] SpotifyTitleDisplay → SEMI-ACTIVE (patch installed, passthrough mode)");
                }
            }
        } catch(e) { this._log("warn", `[STD] Semi-active patch failed: ${e.message}`); }
        SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"].mode      = "semi";
        SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"].startedAt = Date.now();
        SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"].stoppedAt = null;
        this._log("plugin", "[STD] SpotifyTitleDisplay → SEMI-ACTIVE");
    }

    _stopSTD() {
        this._stdSemiActive = false;
        if (this._stdPatcher) {
            this._stdPatcher();
            this._stdPatcher = null;
            this._log("plugin", "[STD] SpotifyTitleDisplay → DISABLED");
        }
    }

    _startPoll() {
        this._stopPoll();
        this._pollTimer = setInterval(() => this._tick(), this._settings.pollInterval ?? 700);
        this._log("debug", `Poll started — interval: ${this._settings.pollInterval}ms`);
    }

    _stopPoll() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    }

    // ─── Consent modal ────────────────────────────────────────────────────────
    // forceReview=true  → read-only (⚠ Risks button): only a "Close" button, no onAccept
    // forceReview=false → first-enable consent flow: Back + "I Accept & Enable"

    _showConsentModal(pluginKey, onAccept, forceReview = false) {
        const plInfo   = SpotifyEnhanced.SUB_PLUGINS[pluginKey] ?? { name: pluginKey, version: "?" };
        const appealUrl = SpotifyEnhanced.APPEAL_URL;

        const RISKS = {
            spotifylyrics: {
                level:    "VERY LOW",
                levelCol: "#57f287",
                what:     "SpotifyLyrics reads your currently playing Spotify track from Discord's native SpotifyStore (already available in the Discord client) and updates your custom status text using Discord's own internal settings dispatcher.",
                how:      "The status update is a local Flux dispatch — the exact same mechanism Discord's own settings panel uses. Zero external HTTP requests are sent to Discord's servers.",
                tos:      "Automating user profile changes is prohibited by Discord's Terms of Service §14. Detection would require another user filing a report.",
                banRisk:  "Extremely unlikely in practice. No server-side fingerprint is produced.",
                banTime:  "If actioned (unlikely): temporary suspension, 1–30 days. Permanent bans for passive status automation are essentially unheard of.",
                appealMsg: `Subject: Account Appeal — Passive Status Automation via BetterDiscord

Hello Discord Trust & Safety,

I am writing to appeal the action taken on my account [username#0000].

The violation relates to my use of a BetterDiscord plugin called SpotifyLyrics. This plugin read my currently playing Spotify track from Discord's own internal data store and updated my custom status text using Discord's internal settings API — the same mechanism Discord's own UI uses. It did not send any HTTP requests to Discord servers, did not involve any bot or automation framework, and did not interact with or harm any other users in any way.

I fully understand that client modifications fall outside Discord's Terms of Service. I have since uninstalled BetterDiscord and all associated plugins and have no intention of using client mods in the future.

I have been using Discord since [date] and would greatly appreciate the restoration of my account.

Thank you for your time.
[Your username#0000]`,
            },
            spotifytitledisplay: {
                level:    "LOW–MEDIUM",
                levelCol: "#fee75c",
                what:     "SpotifyTitleDisplay monkey-patches a Discord internal JavaScript function to replace the artist name displayed in Spotify Rich Presence statuses (the small activity shown under your name to other users).",
                how:      "The patch is applied locally in your browser process. It intercepts the rendering function before it returns and swaps the displayed text. Other users see a modified status.",
                tos:      "Modifying Discord's client-side code is explicitly prohibited by Discord's Terms of Service §5. Because the modification changes what other users see (your Spotify status), it is more visible than a purely local tweak.",
                banRisk:  "Low to medium. Not detectable by Discord's servers directly, but another user could notice the modified display and report it.",
                banTime:  "If actioned: typically a temporary suspension (7–30 days) on a first offence. Repeat offences may result in a permanent ban.",
                appealMsg: `Subject: Account Appeal — Cosmetic BetterDiscord Plugin

Hello Discord Trust & Safety,

I am writing to appeal the action taken on my account [username#0000].

The violation relates to my use of a BetterDiscord plugin called SpotifyTitleDisplay. This plugin patched a local rendering function to display the song title instead of the artist name in my Spotify Rich Presence status. The modification was purely cosmetic — it did not send any unauthorised requests to Discord's API, did not use any bot or automation framework, and was not intended to deceive or harm any other users.

I fully understand that modifying Discord's client is against your Terms of Service. I have since removed BetterDiscord and all plugins and will not use client modifications going forward.

I have been a Discord user since [date] and would sincerely appreciate having my account reinstated.

Thank you.
[Your username#0000]`,
            },
        };

        const r = RISKS[pluginKey] ?? {
            level: "UNKNOWN", levelCol: "#99aab5",
            summary: "Risk information unavailable for this plugin.",
            details: "Please review Discord's Terms of Service before enabling.",
            banTime: "Unknown.",
            appealMsg: `Please submit an appeal at ${appealUrl}`,
        };

        // Skip if already consented and not a forced review
        if (this._consented[pluginKey] && !forceReview) { onAccept?.(); return; }

        // ── Overlay ────────────────────────────────────────────────────────────
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px)";
        // Click outside = close only in review mode
        overlay.onclick = (e) => { if (e.target === overlay && forceReview) overlay.remove(); };

        // ── Modal card ────────────────────────────────────────────────────────
        const M = document.createElement("div");
        M.style.cssText = "background:#1e1f22;color:#dbdee1;border-radius:14px;max-width:540px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.9);display:flex;flex-direction:column;max-height:92vh;overflow:hidden";
        overlay.appendChild(M);

        // ── Header ────────────────────────────────────────────────────────────
        const mHdr = document.createElement("div");
        mHdr.style.cssText = "padding:20px 24px 16px;border-bottom:1px solid #3f4147;display:flex;align-items:flex-start;gap:12px;flex-shrink:0";
        const mIcon = document.createElement("div");
        mIcon.textContent   = "⚠️";
        mIcon.style.cssText = "font-size:24px;flex-shrink:0;margin-top:2px";
        const mTitleWrap = document.createElement("div");
        mTitleWrap.style.flex = "1";
        const mTitle = document.createElement("div");
        mTitle.style.cssText = "font-size:17px;font-weight:800;color:#fff;line-height:1.3";
        mTitle.textContent   = forceReview
            ? `Risk Conditions — ${plInfo.name}`
            : `Enable ${plInfo.name}?`;
        const mSub = document.createElement("div");
        mSub.style.cssText = "font-size:12px;color:#949ba4;margin-top:3px";
        mSub.textContent   = forceReview
            ? "Read-only review — no changes will be made"
            : "Read these conditions carefully before enabling this plugin";
        mTitleWrap.append(mTitle, mSub);
        mHdr.append(mIcon, mTitleWrap);
        M.appendChild(mHdr);

        // ── Scrollable body ───────────────────────────────────────────────────
        const mBody = document.createElement("div");
        mBody.style.cssText = "padding:20px 24px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;flex:1;min-height:0";
        M.appendChild(mBody);

        // Risk level badge row
        const levelRow = document.createElement("div");
        levelRow.style.cssText = "display:flex;align-items:center;gap:10px";
        levelRow.innerHTML = `
            <span style="font-size:11px;font-weight:600;color:#949ba4;text-transform:uppercase;letter-spacing:.06em">Overall risk</span>
            <span style="font-size:12px;font-weight:800;padding:3px 12px;border-radius:4px;background:${r.levelCol}22;color:${r.levelCol};border:1px solid ${r.levelCol}55">${r.level}</span>
            <span style="font-size:11px;color:#949ba4">Click "Show more details" below for full breakdown</span>
        `;
        mBody.appendChild(levelRow);

        // Summary block
        const summBox = document.createElement("div");
        summBox.style.cssText = "background:#2b2d31;border-radius:8px;padding:12px 14px;font-size:13px;color:#dbdee1;line-height:1.65;border-left:3px solid #5865f2";
        summBox.innerHTML = `<b style="color:#fff;display:block;margin-bottom:6px">What it does</b>${r.what}`;
        mBody.appendChild(summBox);

        // Details (collapsible)
        const mkCollapsible = (triggerText, content) => {
            const wrap  = document.createElement("div");
            const hdr   = document.createElement("div");
            hdr.style.cssText = "display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none;color:#949ba4;font-size:12px;font-weight:600;padding:2px 0";
            const chevron = document.createElementNS("http://www.w3.org/2000/svg","svg");
            chevron.setAttribute("width","12"); chevron.setAttribute("height","12");
            chevron.setAttribute("viewBox","0 0 24 24"); chevron.setAttribute("fill","none");
            chevron.setAttribute("stroke","currentColor"); chevron.setAttribute("stroke-width","2.5");
            chevron.setAttribute("stroke-linecap","round"); chevron.setAttribute("stroke-linejoin","round");
            chevron.style.cssText = "transition:transform .15s;flex-shrink:0";
            const poly = document.createElementNS("http://www.w3.org/2000/svg","polyline");
            poly.setAttribute("points","6 9 12 15 18 9");
            chevron.appendChild(poly);
            const lbl = document.createElement("span"); lbl.textContent = triggerText;
            hdr.append(chevron, lbl);
            const body = document.createElement("div");
            body.style.display = "none";
            hdr.onclick = () => {
                const open = body.style.display !== "none";
                body.style.display = open ? "none" : "block";
                chevron.style.transform = open ? "" : "rotate(180deg)";
            };
            wrap.append(hdr, body);
            return { wrap, body };
        };

        // Details collapsible
        const { wrap: detWrap, body: detBody } = mkCollapsible("Show more details & ban timeline");
        detBody.style.cssText = "display:none;margin-top:6px;background:#111214;border-radius:8px;padding:12px 14px;font-size:12px;color:#b5bac1;line-height:1.65;border:1px solid #3f4147";
        detBody.innerHTML = `
            <div style="margin-bottom:8px"><b style="color:#dbdee1">How it works</b><br>${r.how}</div>
            <div style="margin-bottom:8px"><b style="color:#dbdee1">ToS reference</b><br>${r.tos}</div>
            <div style="margin-bottom:8px"><b style="color:#fee75c">Ban risk</b><br>${r.banRisk}</div>
            <div><b style="color:#dbdee1">⏱ If actioned</b><br>${r.banTime}</div>
        `;
        mBody.appendChild(detWrap);

        // Appeal collapsible
        const { wrap: appWrap, body: appBody } = mkCollapsible("Sample appeal message (click to expand)");
        appBody.style.cssText = "display:none;margin-top:8px;flex-direction:column;gap:8px";
        const appPre = document.createElement("pre");
        appPre.textContent   = r.appealMsg;
        appPre.style.cssText = "background:#111214;color:#dbdee1;border-radius:8px;padding:14px;font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-word;border:1px solid #3f4147;margin:0;line-height:1.6;user-select:text";
        const appActions = document.createElement("div");
        appActions.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";
        const appHint = document.createElement("span");
        appHint.textContent   = "Replace [Your username#0000] and [date] before sending";
        appHint.style.cssText = "font-size:11px;color:#949ba4;font-style:italic;flex:1";
        const cpBtn = document.createElement("button");
        cpBtn.textContent   = "📋 Copy";
        cpBtn.style.cssText = "padding:5px 12px;border-radius:5px;border:none;background:#5865f2;color:#fff;cursor:pointer;font-size:11px;font-weight:600;flex-shrink:0";
        cpBtn.onclick = () => { navigator.clipboard.writeText(r.appealMsg).then(() => { cpBtn.textContent = "✓ Copied!"; setTimeout(() => { cpBtn.textContent = "📋 Copy"; }, 1800); }); };
        const appLink = document.createElement("a");
        appLink.href      = appealUrl;
        appLink.target    = "_blank";
        appLink.rel       = "noopener noreferrer";
        appLink.textContent = "Open appeal page →";
        appLink.style.cssText = "font-size:11px;color:#5865f2;text-decoration:underline;cursor:pointer;flex-shrink:0";
        appActions.append(appHint, cpBtn, appLink);
        appBody.append(appPre, appActions);
        mBody.appendChild(appWrap);

        // Disclaimer (consent flow only)
        if (!forceReview) {
            const disc = document.createElement("div");
            disc.style.cssText = "font-size:12px;color:#949ba4;font-style:italic;line-height:1.55;background:#2b2d31;border-radius:8px;padding:10px 14px;border-left:3px solid #ed4245";
            disc.textContent = 'By clicking "I Accept & Enable", you confirm that you have read and understood the risks above and take full personal responsibility for your Discord account.';
            mBody.appendChild(disc);
        }

        // ── Footer ────────────────────────────────────────────────────────────
        const mFoot = document.createElement("div");
        mFoot.style.cssText = "padding:16px 24px;border-top:1px solid #3f4147;display:flex;gap:10px;justify-content:flex-end;background:#1a1b1e;border-radius:0 0 14px 14px;flex-shrink:0";

        if (forceReview) {
            // Read-only: single Close button
            const closeBtn = document.createElement("button");
            closeBtn.textContent   = "✕ Close";
            closeBtn.style.cssText = "padding:9px 22px;border-radius:7px;border:none;background:#5865f2;color:#fff;cursor:pointer;font-size:13px;font-weight:700";
            closeBtn.onclick = () => overlay.remove();
            mFoot.appendChild(closeBtn);
        } else {
            // Consent flow: Back + Accept
            const backBtn = document.createElement("button");
            backBtn.textContent   = "← Go Back";
            backBtn.style.cssText = "padding:9px 18px;border-radius:7px;border:none;background:#2b2d31;color:#dbdee1;cursor:pointer;font-size:13px;font-weight:600";
            backBtn.onclick = () => overlay.remove();

            const acceptBtn = document.createElement("button");
            acceptBtn.textContent   = "I Accept & Enable";
            acceptBtn.style.cssText = "padding:9px 22px;border-radius:7px;border:none;background:#ed4245;color:#fff;cursor:pointer;font-size:13px;font-weight:800;letter-spacing:.02em";
            acceptBtn.onclick = () => {
                overlay.remove();
                this._consented[pluginKey] = true;
                BdApi.Data.save(SpotifyEnhanced.PLUGIN_NAME, "consented", this._consented);
                this._log("plugin", `[consent] User accepted risks for ${plInfo.name} v${plInfo.version}`);
                onAccept();
            };
            mFoot.append(backBtn, acceptBtn);
        }
        M.appendChild(mFoot);
        document.body.appendChild(overlay);
    }

    _disableSpotifyLyrics() {
        this._enabled = false;
        // Cancel in-flight fetches
        if (this._abortController) { this._abortController.abort(); this._abortController = null; }
        // Clear prefetch queue
        this._prefetching.clear();
        // Clear track header timer
        if (this._trackHeaderTimer) { clearTimeout(this._trackHeaderTimer); this._trackHeaderTimer = null; }
        // Restore status if was playing
        if (this._isPlaying) {
            this._isPlaying = false;
            this._restoreStatus();
        }
        this._currentTrackId    = null;
        this._currentLyrics     = null;
        this._lastDisplayedLine = null;
        this._repeatCount       = 0;
        this._autoInstruShown   = false;
        this._log("plugin", "SpotifyLyrics → DISABLED — all tasks cancelled, status restored");
    }

    _enableSpotifyLyrics() {
        this._enabled    = true;
        this._semiActive = false;
        this._startPoll();
        SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"].mode      = "active";
        SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"].startedAt = Date.now();
        SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"].stoppedAt = null;
        this._log("plugin", `SpotifyLyrics → ACTIVE — poll interval: ${this._settings?.pollInterval ?? 700}ms`);
    }

    _semiSpotifyLyrics() {
        // Semi-active: poll Spotify store + pre-cache lyrics — NO status updates, NO external requests
        this._enabled    = false;  // prevent status updates
        this._semiActive = true;
        this._startPoll();         // poll still runs but _applyStatus is gated
        SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"].mode      = "semi";
        SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"].startedAt = Date.now();
        SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"].stoppedAt = null;
        this._log("plugin", `SpotifyLyrics → SEMI-ACTIVE — poll: on, lyrics: on, status updates: off, external requests: off`);
    }

    // ─── Schedule check ───────────────────────────────────────────────────────

    _isInSchedule() {
        if (!this._settings.scheduleEnabled) return true;
        const now  = new Date();
        const cur  = now.getHours() * 60 + now.getMinutes();
        const [fh, fm] = (this._settings.scheduleFrom ?? "08:00").split(":").map(Number);
        const [th, tm] = (this._settings.scheduleTo   ?? "23:00").split(":").map(Number);
        const from = fh * 60 + fm;
        const to   = th * 60 + tm;
        return from <= to ? cur >= from && cur <= to : cur >= from || cur <= to;
    }

    // ─── Discord modules ──────────────────────────────────────────────────────

    _resolveDiscordModules() {
        this._SpotifyStore = BdApi.Webpack.getStore("SpotifyStore");
        if (!this._SpotifyStore)
            this._log("error", "SpotifyStore not found — Spotify must be connected to Discord");

        const candidates = BdApi.Webpack.getModules(
            m => typeof m?.updateAsync === "function",
            { searchExports: true }
        ) ?? [];
        this._UserSettingsUpdater = candidates.find(
            m => m.ProtoClass?.fields?.some(f => f.name === "status")
        ) ?? null;

        if (!this._UserSettingsUpdater)
            this._log("error", "UserSettingsUpdater not found — status update unavailable");
        else
            this._log("info", "Discord modules resolved successfully");
    }

    // ─── Status ───────────────────────────────────────────────────────────────

    _readCurrentStatus() {
        try {
            const store = BdApi.Webpack.getStore("UserSettingsProtoStore");
            const cs    = store?.settings?.status?.customStatus;
            return { text: cs?.text ?? "", emojiName: cs?.emojiName || null };
        } catch { return null; }
    }

    _isDndActive() {
        try {
            const store = BdApi.Webpack.getStore("UserSettingsProtoStore");
            return store?.settings?.status?.status?.value === "dnd";
        } catch { return false; }
    }

    _saveStatus() {
        if (this._statusSaved) return;
        const current = this._readCurrentStatus();
        if (current !== null) {
            this._savedStatus = current;
            this._log("status", `Status saved → "${current.text}"`);
        }
        this._statusSaved = true;
    }

    _restoreStatus() {
        const text  = this._savedStatus?.text      ?? "";
        const emoji = this._savedStatus?.emojiName ?? null;
        this._applyStatus(text, emoji, true);
        this._statusSaved    = false;
        this._lastSentStatus = null;
        this._log("status", `Status restored → "${text || "(empty)"}" | emoji: ${emoji ?? "none"}`);
    }

    _applyStatus(text, emojiName, force = false) {
        if (!this._UserSettingsUpdater) return;
        // Semi-active: scan + cache only, no status updates to Discord
        if (this._semiActive && !force) return;
        if (this._settings.dndProtect && this._isDndActive()) {
            this._log("warn", "DND active — status update skipped");
            return;
        }
        // Throttle (bypass with force=true for restore)
        if (!force) {
            const now      = Date.now();
            const throttle = this._settings.statusUpdateThrottle ?? 1000;
            if (now - this._lastStatusUpdate < throttle) return;
            this._lastStatusUpdate = now;
        }
        const truncated = (text ?? "").slice(0, this._settings.truncateLength ?? 128);
        const emojiKey  = emojiName ?? "";
        // Skip if exact same status already sent — avoids hammering Discord on fallback/lyricsOnly modes
        if (!force && this._lastSentStatus?.text === truncated && this._lastSentStatus?.emojiName === emojiKey) return;
        try {
            this._UserSettingsUpdater.updateAsync("status", draft => {
                draft.customStatus = {
                    text:        truncated,
                    emojiName:   emojiName ?? "",
                    emojiId:     "0",
                    expiresAtMs: "0",
                };
            });
            this._lastSentStatus = { text: truncated, emojiName: emojiKey };
            this._log("status", `→ "${truncated}"`);
        } catch (e) {
            this._log("error", `updateAsync failed: ${e.message}`);
        }
    }

    _formatStatus(lyric, artist, trackName) {
        // {emoji} is handled by Discord's emoji field — do NOT include in text to avoid duplication
        // Users can use {lyric}, {artist}, {track} in the format template
        const tpl = (this._settings.statusFormat ?? "{lyric}")
            .replace(/\{emoji\}\s*/g, "")  // strip {emoji} placeholder from text
            .replace("{lyric}",  lyric ?? "")
            .replace("{artist}", artist ?? "")
            .replace("{track}",  trackName ?? "");
        return tpl.trim();
    }

    _setLyricStatus(lyric, artist, trackName) {
        const emoji = this._settings.statusEmoji?.trim() || null;  // goes to emojiName field only
        const text  = this._formatStatus(lyric, artist, trackName);
        this._applyStatus(text, emoji);
    }

    // ─── LRC Parser ───────────────────────────────────────────────────────────

    _parseLrc(lrc) {
        const lines = [];
        const re    = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
        let m;
        while ((m = re.exec(lrc)) !== null) {
            const ms = m[3].length === 2 ? parseInt(m[3], 10) * 10 : parseInt(m[3], 10);
            lines.push({
                time: (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000 + ms,
                text: m[4].trim(),
            });
        }
        return lines.sort((a, b) => a.time - b.time);
    }

    // ─── LRCLIB ───────────────────────────────────────────────────────────────

    async _lrclibGet(trackName, artistName) {
        const p = new URLSearchParams({ track_name: trackName });
        if (artistName) p.set("artist_name", artistName);
        const url = `${SpotifyEnhanced.LRCLIB_BASE}/get?${p}`;
        this._log("network", `GET ${url}`);
        const res = await fetch(url, { signal: AbortSignal.timeout(this._settings.lrclibTimeout ?? 12000) });
        if (res.status === 404) { this._log("network", "LRCLIB 404 — pas de résultat direct"); return null; }
        if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
        return res.json();
    }

    async _lrclibSearch(trackName, artistName) {
        const p   = new URLSearchParams({ q: `${trackName} ${artistName}`.trim() });
        const url = `${SpotifyEnhanced.LRCLIB_BASE}/search?${p}`;
        this._log("network", `SEARCH ${url}`);
        const res = await fetch(url, { signal: AbortSignal.timeout(this._settings.lrclibTimeout ?? 12000) });
        if (!res.ok) return null;
        const results = await res.json();
        if (!results?.length) { this._log("network", "LRCLIB search — 0 résultats"); return null; }
        const pick = results.find(r => r.syncedLyrics) ?? results[0];
        this._log("network", `LRCLIB search — ${results.length} résultats, pick: "${pick?.trackName}"`);
        return pick;
    }

    async _fetchLyrics(trackName, artistName) {
        this._log("network", `Fetching lyrics: "${trackName}" — "${artistName}"`);
        let data = null;
        try { data = await this._lrclibGet(trackName, artistName); } catch (e) { this._log("warn", `lrclibGet (with artist) failed: ${e.message}`); }
        if (!data) {
            try { data = await this._lrclibGet(trackName); } catch (e) { this._log("warn", `lrclibGet (no artist) failed: ${e.message}`); }
        }
        if (!data && this._settings.lrclibFallbackSearch) {
            try { data = await this._lrclibSearch(trackName, artistName); } catch (e) { this._log("warn", `lrclibSearch failed: ${e.message}`); }
        }
        if (!data?.syncedLyrics) {
            this._log("warn", `No synced lyrics for "${trackName}"`);
            return null;
        }
        const lines = this._parseLrc(data.syncedLyrics);
        this._log("cache", `Lyrics parsed — ${lines.length} lines for "${trackName}"`);
        return lines;
    }

    // ─── Cache ────────────────────────────────────────────────────────────────

    _getCached(id) {
        const e = this._lyricsCache.get(id);
        if (!e) return null;
        if (Date.now() - e.cachedAt > SpotifyEnhanced.CACHE_TTL) { this._lyricsCache.delete(id); return null; }
        return e;
    }

    _setCache(id, lyrics) {
        if (this._lyricsCache.size >= SpotifyEnhanced.CACHE_MAX) {
            const oldest = [...this._lyricsCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
            this._lyricsCache.delete(oldest[0]);
            this._log("cache", `Cache full — evicting: ${oldest[0]}`);
        }
        this._lyricsCache.set(id, { lyrics, cachedAt: Date.now() });
        this._log("cache", `Cache set — id: ${id} (${this._lyricsCache.size}/${SpotifyEnhanced.CACHE_MAX})`);
    }

    _prefetchTrack(id, name, artist) {
        if (this._getCached(id) || this._prefetching.has(id)) return;
        this._prefetching.add(id);
        this._log("cache", `Prefetching: "${name}"`);
        this._fetchLyrics(name, artist)
            .then(lyrics  => this._setCache(id, lyrics))
            .catch(e      => { this._log("warn", `Prefetch failed: ${e.message}`); this._setCache(id, null); })
            .finally(()   => this._prefetching.delete(id));
    }

    // ─── Spotify queue prefetch ───────────────────────────────────────────────

    async _tryPrefetchQueue() {
        const token = this._SpotifyStore?.getActiveSocketAndDevice?.()?.socket?.accessToken;
        if (!token) return;
        try {
            this._log("spotify", "Fetching Spotify queue...");
            const res = await fetch("https://api.spotify.com/v1/me/player/queue", {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) { this._log("warn", `Queue fetch HTTP ${res.status}`); return; }
            const data = await res.json();
            const next = data?.queue?.[0];
            if (next?.id) {
                this._log("spotify", `Next track detected: "${next.name}" — prefetching...`);
                this._prefetchTrack(next.id, next.name, next.artists?.[0]?.name ?? "");
            } else {
                this._log("spotify", "Queue empty or no next track");
            }
        } catch (e) { this._log("warn", `Queue prefetch error: ${e.message}`); }
    }

    // ─── History ──────────────────────────────────────────────────────────────

    _addHistory(track) {
        if (!this._settings.historyEnabled) return;
        const max = this._settings.historyMax ?? SpotifyEnhanced.HISTORY_DEFAULT;
        this._history = this._history.filter(h => h.id !== track.id);
        this._history.unshift({
            id:     track.id,
            name:   track.name,
            artist: track.artists?.[0]?.name ?? "",
            at:     Date.now(),
        });
        if (this._history.length > max) this._history = this._history.slice(0, max);
        BdApi.Data.save(SpotifyEnhanced.PLUGIN_NAME, "history", this._history);
        this._log("info", `History updated — ${this._history.length} tracks`);
    }

    // ─── Instrumental / format ────────────────────────────────────────────────

    _isInstrumental(text) { return SpotifyEnhanced.INSTRUMENTAL_RE.test(text.trim()); }
    _formatLine(text)     { return this._isInstrumental(text) ? this._settings.instrumentalText : text; }

    // ─── Main tick ────────────────────────────────────────────────────────────

    async _tick() {
        // Internal enable check
        if (!this._enabled) return;
        // Schedule check
        if (!this._isInSchedule()) {
            if (this._isPlaying) {
                this._isPlaying = false;
                this._restoreStatus();
                this._log("info", "Outside schedule — status restored");
            }
            return;
        }

        const store    = this._SpotifyStore;
        const track    = store?.getTrack?.()    ?? null;
        const activity = store?.getActivity?.() ?? null;
        const playing  = !!activity;

        // Offset: per-track override > global setting
        const globalOffset  = this._settings.lyricsOffsetMs ?? 0;
        const perTrackOff   = track ? (this._trackOffsets[track.id] ?? 0) : 0;
        const offset        = perTrackOff + globalOffset;
        const position      = activity?.timestamps?.start
            ? Math.max(0, Date.now() - activity.timestamps.start + offset)
            : 0;

        // ── PAUSE / STOP ──────────────────────────────────────────────────────
        if (!track || !playing) {
            if (this._isPlaying) {
                this._isPlaying       = false;
                this._currentTrackId  = null;
                this._currentLyrics   = null;
                this._lastDisplayedLine = null;
                this._trackHeaderShown  = false;
                this._autoInstruShown   = false;
                this._repeatCount       = 0;
                if (this._trackHeaderTimer) { clearTimeout(this._trackHeaderTimer); this._trackHeaderTimer = null; }
                this._log("spotify", "Playback stopped / paused");
                this._restoreStatus();
            }
            return;
        }

        // ── BLACKLIST ─────────────────────────────────────────────────────────
        if (this._blacklist.has(track.id)) {
            this._log("debug", `Blacklisted track skipped: "${track.name}"`);
            return;
        }

        // ── NEW TRACK ─────────────────────────────────────────────────────────
        if (track.id !== this._currentTrackId) {
            this._saveStatus();
            if (this._trackHeaderTimer) { clearTimeout(this._trackHeaderTimer); this._trackHeaderTimer = null; }

            const prevId        = this._currentTrackId;
            this._currentTrackId    = track.id;
            this._currentLyrics     = null;
            this._lastDisplayedLine = null;
            this._trackHeaderShown  = false;
            this._autoInstruShown   = false;
            this._repeatCount       = 0;
            this._repeatText        = null;
            this._isPlaying         = true;

            const artist = track.artists?.[0]?.name ?? "";
            this._log("spotify", `New track: "${track.name}" — "${artist}"${prevId ? ` (précédent: ${prevId})` : ""}`);
            this._addHistory(track);

            // Show track name header immediately
            if (this._settings.showTrackNameBeforeLyrics && !this._settings.lyricsOnlyMode) {
                const headerText = this._formatStatus(`${track.name} — ${artist}`, artist, track.name);
                this._applyStatus(headerText, this._settings.statusEmoji?.trim() || null);
                this._trackHeaderShown = true;
                this._log("status", `Header displayed: "${track.name} — ${artist}"`);

                // Auto-hide header after trackNameDuration ms if still no lyrics
                const dur = this._settings.trackNameDuration ?? 5000;
                this._trackHeaderTimer = setTimeout(() => {
                    if (this._currentTrackId === track.id && !this._lastDisplayedLine) {
                        // Still no lyric shown → show instru
                        const instrText = this._formatStatus(this._settings.instrumentalText, artist, track.name);
                        this._applyStatus(instrText, this._settings.statusEmoji?.trim() || null);
                        this._log("status", `Header expired (${dur}ms) no lyrics → instru`);
                    }
                    this._trackHeaderTimer = null;
                }, dur);
            }

            // Load lyrics (cache-first)
            const cached = this._getCached(track.id);
            if (cached) {
                this._currentLyrics = cached.lyrics;
                this._log("cache", `Lyrics from cache for "${track.name}"`);
            } else {
                const capturedId = track.id;
                this._fetchLyrics(track.name, artist)
                    .then(lyrics => {
                        this._setCache(capturedId, lyrics);
                        if (capturedId === this._currentTrackId) {
                            this._currentLyrics = lyrics;
                            this._log("lyric", `Lyrics loaded (async): ${lyrics?.length ?? 0} lines`);
                        }
                    })
                    .catch(e => {
                        this._log("error", `Lyrics fetch failed: ${e.message}`);
                        this._setCache(capturedId, null);
                    });
            }

            // Prefetch queue immediately on track change
            this._lastQueuePrefetch = Date.now();
            this._tryPrefetchQueue();
            return;
        }

        // ── RESUME (was paused) ───────────────────────────────────────────────
        if (!this._isPlaying) {
            this._saveStatus();
            this._isPlaying = true;
            this._log("spotify", "Playback resumed");
        }

        // ── LYRICS ONLY MODE (no LRCLIB, just track name) ────────────────────
        if (this._settings.lyricsOnlyMode) {
            const artist = track.artists?.[0]?.name ?? "";
            const text   = this._formatStatus(`${track.name} — ${artist}`, artist, track.name);
            this._applyStatus(text, this._settings.statusEmoji?.trim() || null);
            return;
        }

        // ── PERIODIC QUEUE PREFETCH ───────────────────────────────────────────
        if (Date.now() - this._lastQueuePrefetch > (this._settings.queuePrefetchDelay ?? 30000)) {
            this._lastQueuePrefetch = Date.now();
            this._tryPrefetchQueue();
        }

        // ── NO LYRICS FALLBACK ────────────────────────────────────────────────
        if (!this._currentLyrics?.length) {
            const fb     = this._settings.fallbackNoLyrics ?? "track";
            const artist = track.artists?.[0]?.name ?? "";
            if (fb === "track") {
                const text = this._formatStatus(`${track.name} — ${artist}`, artist, track.name);
                this._applyStatus(text, this._settings.statusEmoji?.trim() || null);
            } else if (fb === "custom" && this._settings.fallbackCustomText?.trim()) {
                this._applyStatus(this._settings.fallbackCustomText.trim(), this._settings.statusEmoji?.trim() || null);
            }
            // fb === "none" → do nothing
            return;
        }

        // ── LYRICS DISPLAY ────────────────────────────────────────────────────
        const artist    = track.artists?.[0]?.name ?? "";
        const firstLine = this._currentLyrics.find(l => l.text.trim() !== "");

        if (firstLine && position < firstLine.time) {
            // Before first lyric — header already shown, nothing to do
            return;
        }

        const currentLine = this._currentLyrics
            .filter(l => l.time <= position && l.text.trim() !== "")
            .at(-1);

        // ── AUTO INSTRU GAP ───────────────────────────────────────────────────
        const autoInstruGap = this._settings.autoInstruGap ?? 8000;

        if (!currentLine && firstLine && position >= firstLine.time) {
            if (!this._autoInstruShown) {
                this._autoInstruShown = true;
                this._log("lyric", "No active line (before first lyric) → auto instru");
                const text = this._formatStatus(this._settings.instrumentalText, artist, track.name);
                this._applyStatus(text, this._settings.statusEmoji?.trim() || null);
            }
            return;
        }

        if (currentLine) {
            const nextLine = this._currentLyrics.find(l => l.time > currentLine.time && l.text.trim() !== "");
            const inGap    = nextLine && (nextLine.time - currentLine.time) > autoInstruGap;
            const gapStart = currentLine.time + Math.min(autoInstruGap * 0.5, 3000);

            if (inGap && position > gapStart) {
                if (!this._autoInstruShown) {
                    this._autoInstruShown = true;
                    this._log("lyric", `Gap ${Math.round((nextLine.time - currentLine.time) / 1000)}s detected → auto instru`);
                    const text = this._formatStatus(this._settings.instrumentalText, artist, track.name);
                    this._applyStatus(text, this._settings.statusEmoji?.trim() || null);
                }
                return;
            } else {
                this._autoInstruShown = false;
            }

            // ── NEW LINE ─────────────────────────────────────────────────────
            const isNewLine = (
                currentLine.text !== this._lastDisplayedLine?.text ||
                currentLine.time !== this._lastDisplayedLine?.time
            );

            if (isNewLine) {
                // Repeat counter
                if (this._settings.showRepeatCount && this._lastDisplayedLine?.text === currentLine.text) {
                    this._repeatCount++;
                } else {
                    this._repeatCount = 1;
                    this._repeatText  = currentLine.text;
                }
                this._lastDisplayedLine = currentLine;

                let base      = this._formatLine(currentLine.text);
                let display   = base;

                if (this._settings.showRepeatCount && this._repeatCount > 1) {
                    const counter = ` (x${this._repeatCount})`;
                    const maxBase = (this._settings.truncateLength ?? 128) - counter.length;
                    display = base.slice(0, maxBase) + counter;
                }

                this._log("lyric", `[${Math.round(position / 1000)}s] "${display}"${this._repeatCount > 1 ? ` (repeat x${this._repeatCount})` : ""}`);
                const text = this._formatStatus(display, artist, track.name);
                this._applyStatus(text, this._settings.statusEmoji?.trim() || null);
            }
        }
    }

    // ─── Settings UI ──────────────────────────────────────────────────────────

    getSettingsPanel() {
        const s    = this._settings;
        const root = document.createElement("div");
        root.style.cssText = "font-size:14px;color:var(--text-normal)";

        // ── Plugin nav (Discord-style tab bar, not a <select>) ──────────────────
        const navBar = document.createElement("div");
        navBar.style.cssText = [
            "display:flex",
            "align-items:stretch",
            "padding:0 16px",
            "background:var(--background-secondary-alt)",
            "border-bottom:2px solid var(--background-modifier-accent)",
            "gap:2px",
        ].join(";");

        const pluginContainer = document.createElement("div");
        root.appendChild(navBar);
        root.appendChild(pluginContainer);

        // Plugin registry — pulled from static SUB_PLUGINS (single source of truth)
        const pluginList = Object.values(SpotifyEnhanced.SUB_PLUGINS);

        let activePage = "main";

        const renderPluginPage = (key) => {
            activePage = key;
            pluginContainer.innerHTML = "";
            // Update nav highlight
            navBar.querySelectorAll("[data-nav]").forEach(el => {
                const active = el.dataset.nav === key;
                el.style.color        = active ? "var(--text-normal)"  : "var(--text-muted)";
                el.style.borderBottom = active ? "2px solid var(--brand-experiment)" : "2px solid transparent";
                el.style.fontWeight   = active ? "700" : "500";
                el.style.marginBottom = "-2px";
            });
            if (key === "main")                      renderPluginMain();
            else if (key === "spotifylyrics")        renderPluginLyrics();
            else if (key === "spotifytitledisplay") renderPluginSTD();
        };

        // Build nav tabs
        [{ key: "main", label: "🏠 Main" }, { key: "spotifylyrics", label: SpotifyEnhanced.SUB_PLUGINS.spotifylyrics.navLabel }, { key: "spotifytitledisplay", label: SpotifyEnhanced.SUB_PLUGINS.spotifytitledisplay.navLabel }]
        .forEach(({ key, label }) => {
            const tab = document.createElement("button");
            tab.dataset.nav    = key;
            tab.textContent    = label;
            tab.style.cssText  = [
                "background:transparent",
                "border:none",
                "border-bottom:2px solid transparent",
                "color:var(--text-muted)",
                "cursor:pointer",
                "font-size:13px",
                "font-weight:500",
                "padding:10px 14px",
                "transition:color .15s",
                "margin-bottom:-2px",
                "white-space:nowrap",
            ].join(";");
            tab.onmouseenter = () => { if (activePage !== key) tab.style.color = "var(--text-normal)"; };
            tab.onmouseleave = () => { if (activePage !== key) tab.style.color = "var(--text-muted)"; };
            tab.onclick      = () => renderPluginPage(key);
            navBar.appendChild(tab);
        });

        // ── Main page ─────────────────────────────────────────────────────────
        const renderPluginMain = () => {
            const wrap = document.createElement("div");
            wrap.style.cssText = "display:flex;flex-direction:column;height:100%";
            pluginContainer.appendChild(wrap);

            // Inner tab bar
            const innerNav = document.createElement("div");
            innerNav.style.cssText = "display:flex;padding:0 16px;border-bottom:2px solid #2e3035;flex-shrink:0";
            let mainTab = "plugins";
            const mainContent = document.createElement("div");
            mainContent.style.cssText = "padding:16px;overflow-y:auto;flex:1";
            wrap.append(innerNav, mainContent);

            const INNER_TABS = [
                { key: "plugins", label: "🔌 Plugins" },
                { key: "logs",    label: "📋 Logs"    },
                { key: "cache",   label: "🗄 Cache"   },
                { key: "options", label: "⚙️ Options"  },
            ];

            const setMainTab = (tab) => {
                mainTab = tab;
                mainContent.innerHTML = "";
                innerNav.querySelectorAll("[data-mtab]").forEach(el => {
                    const a = el.dataset.mtab === tab;
                    el.style.color        = a ? "#fff" : "#72767d";
                    el.style.borderBottom = a ? "2px solid #5865f2" : "2px solid transparent";
                    el.style.fontWeight   = a ? "600" : "400";
                    el.style.marginBottom = "-2px";
                });
                ({ plugins: renderMainPlugins, logs: renderMainLogs, cache: renderMainCache, options: renderMainOptions }[tab] ?? (() => {}))();
            };

            INNER_TABS.forEach(({ key, label }) => {
                const tb = document.createElement("button");
                tb.dataset.mtab  = key;
                tb.textContent   = label;
                tb.style.cssText = "background:transparent;border:none;border-bottom:2px solid transparent;color:#72767d;cursor:pointer;font-size:13px;font-weight:400;padding:10px 14px;margin-bottom:-2px;transition:color .12s,border-color .12s;white-space:nowrap";
                tb.onclick = () => setMainTab(key);
                innerNav.appendChild(tb);
            });

            // ─── Plugins ─────────────────────────────────────────────────────
            const renderMainPlugins = () => {
                mainContent.innerHTML = "";

                const getMode = (key) => {
                    if (key === "spotifylyrics") {
                        if (this._enabled)    return "active";
                        if (this._semiActive) return "semi";
                        return "disabled";
                    }
                    if (key === "spotifytitledisplay") {
                        if (this._stdEnabled)    return "active";
                        if (this._stdSemiActive) return "semi";
                        return "disabled";
                    }
                    return "disabled";
                };

                const applyMode = (key, mode, onDone) => {
                    const needsConsent = mode !== "disabled" && !this._consented[key];
                    if (needsConsent) {
                        this._showConsentModal(key, () => applyMode(key, mode, onDone));
                        return;
                    }
                    if (key === "spotifylyrics") {
                        this._disableSpotifyLyrics();
                        if (mode === "active")   this._enableSpotifyLyrics();
                        else if (mode === "semi") this._semiSpotifyLyrics();
                        else {
                            SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"].mode      = "disabled";
                            SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"].stoppedAt = Date.now();
                        }
                    } else if (key === "spotifytitledisplay") {
                        if (mode === "active") {
                            this._stdEnabled = true; this._stdSemiActive = false;
                            this._startSTD();
                            SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"].mode      = "active";
                            SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"].startedAt = Date.now();
                        } else if (mode === "semi") {
                            this._semiSTD();
                        } else {
                            this._stopSTD();
                            SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"].mode      = "disabled";
                            SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"].stoppedAt = Date.now();
                        }
                    }
                    onDone?.();
                };

                pluginList.forEach(pl => {
                    // ── Card ──────────────────────────────────────────────────
                    const card = document.createElement("div");
                    card.style.cssText = "background:#1e1f22;border-radius:12px;overflow:hidden;margin-bottom:12px;border:1px solid #2e3035;transition:border-color .2s";

                    // ── Card top (dark header) ────────────────────────────────
                    const cardTop = document.createElement("div");
                    cardTop.style.cssText = "background:#111214;padding:14px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid #2e3035";

                    const nameEl = document.createElement("span");
                    nameEl.textContent   = pl.name;
                    nameEl.style.cssText = "font-weight:700;font-size:14px;color:#fff;flex-shrink:0";

                    const verEl = document.createElement("span");
                    verEl.textContent   = `v${pl.version}`;
                    verEl.style.cssText = "font-size:10px;color:#72767d;font-family:monospace;flex-shrink:0";

                    const modeBadge = document.createElement("span");
                    modeBadge.style.cssText = "font-size:11px;padding:2px 8px;border-radius:4px;font-weight:700;transition:all .2s;flex-shrink:0";

                    const timingEl = document.createElement("span");
                    timingEl.dataset.timing = pl.key;
                    timingEl.style.cssText  = "font-size:10px;font-family:monospace;color:#72767d;margin-left:auto;flex-shrink:0";

                    cardTop.append(nameEl, verEl, modeBadge, timingEl);

                    // ── Card body ─────────────────────────────────────────────
                    const cardBody = document.createElement("div");
                    cardBody.style.cssText = "padding:14px 16px;display:flex;flex-direction:column;gap:12px";

                    // Plugin desc
                    const descEl = document.createElement("div");
                    descEl.textContent   = pl.desc;
                    descEl.style.cssText = "font-size:12px;color:#b5bac1;line-height:1.5";

                    // Mode description (live)
                    const modeDescEl = document.createElement("div");
                    modeDescEl.style.cssText = "font-size:12px;color:#72767d;line-height:1.5;padding:8px 12px;background:#111214;border-radius:6px;border-left:2px solid #5865f2;min-height:36px;transition:border-color .2s";

                    // 3-state selector
                    const modeRow = document.createElement("div");
                    modeRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px";

                    ["active", "semi", "disabled"].forEach(mode => {
                        const m   = SpotifyEnhanced.MODES[mode];
                        const btn = document.createElement("button");
                        btn.dataset.modeBtn = mode;
                        btn.style.cssText   = "padding:8px 6px;border-radius:8px;border:2px solid transparent;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:3px;background:#111214;color:#72767d";
                        btn.innerHTML       = `<span style="font-size:16px">${m.icon}</span><span>${m.label}</span>`;
                        btn.title           = SpotifyEnhanced.MODE_DESC[pl.key]?.[mode] ?? "";
                        btn.onclick         = () => applyMode(pl.key, mode, () => refreshCard());
                        modeRow.appendChild(btn);
                    });

                    // Action row
                    const actionRow = document.createElement("div");
                    actionRow.style.cssText = "display:flex;gap:8px;padding-top:4px";

                    const goBtn = document.createElement("button");
                    goBtn.textContent   = "Settings →";
                    goBtn.style.cssText = "padding:7px 14px;border-radius:7px;border:none;background:#5865f2;color:#fff;cursor:pointer;font-size:12px;font-weight:600";
                    goBtn.onclick = () => renderPluginPage(pl.key);

                    const tosBtn = document.createElement("button");
                    tosBtn.textContent   = "⚠ Risks";
                    tosBtn.style.cssText = "padding:7px 14px;border-radius:7px;border:1px solid #fee75c55;background:#fee75c11;color:#fee75c;cursor:pointer;font-size:12px;font-weight:600";
                    tosBtn.onclick = () => this._showConsentModal(pl.key, null, true);

                    actionRow.append(tosBtn, goBtn);

                    cardBody.append(descEl, modeDescEl, modeRow, actionRow);
                    card.append(cardTop, cardBody);
                    mainContent.appendChild(card);

                    // ── Refresh card state ────────────────────────────────────
                    const refreshCard = () => {
                        const mode = getMode(pl.key);
                        const m    = SpotifyEnhanced.MODES[mode];
                        const desc = SpotifyEnhanced.MODE_DESC[pl.key]?.[mode] ?? "";

                        card.style.borderColor = { active: "#57f28744", semi: "#fee75c44", disabled: "#2e3035" }[mode];
                        modeBadge.textContent  = `${m.icon} ${m.label}`;
                        modeBadge.style.cssText = `font-size:11px;padding:2px 8px;border-radius:4px;font-weight:700;transition:all .2s;background:${m.color}22;color:${m.color};border:1px solid ${m.color}44`;
                        modeDescEl.textContent  = desc;
                        modeDescEl.style.borderColor = m.color;
                        goBtn.style.opacity      = mode === "disabled" ? "0.4" : "1";
                        goBtn.style.pointerEvents = mode === "disabled" ? "none" : "auto";

                        modeRow.querySelectorAll("[data-mode-btn]").forEach(btn => {
                            const active = btn.dataset.modeBtn === mode;
                            const bm     = SpotifyEnhanced.MODES[btn.dataset.modeBtn];
                            btn.style.background   = active ? bm.color + "22" : "#111214";
                            btn.style.borderColor  = active ? bm.color + "88" : "transparent";
                            btn.style.color        = active ? bm.color : "#72767d";
                        });
                    };
                    refreshCard();
                });

                // Auto-refresh timing every 1s
                const t = setInterval(() => {
                    if (!mainContent.isConnected) { clearInterval(t); return; }
                    pluginList.forEach(pl => {
                        const el    = mainContent.querySelector(`[data-timing="${pl.key}"]`);
                        const state = SpotifyEnhanced.PLUGIN_STATES[pl.key];
                        if (!el || !state) return;
                        const mode = state.mode ?? "disabled";
                        if (mode !== "disabled" && state.startedAt)
                            el.textContent = `up ${Math.round((Date.now() - state.startedAt) / 1000)}s`;
                        else if (mode === "disabled" && state.stoppedAt)
                            el.textContent = `down ${Math.round((Date.now() - state.stoppedAt) / 1000)}s`;
                        else
                            el.textContent = "";
                    });
                }, 1000);
            }; // end renderMainPlugins

            // ─── Logs ─────────────────────────────────────────────────────────
            const renderMainLogs = () => {
                mainContent.innerHTML = "";

                // Plugin filter tabs
                const ALL_PLUGINS = [
                    { key: "all",                 label: "All",                color: "#99aab5" },
                    { key: "SpotifyEnhanced",     label: "SpotifyEnhanced",    color: "#5865f2" },
                    { key: "SpotifyLyrics",       label: "SpotifyLyrics",      color: "#1db954" },
                    { key: "SpotifyTitleDisplay", label: "SpotifyTitleDisplay", color: "#eb459e" },
                ];
                const LEVEL_FILTERS = ["all", "error", "warn", "info", "plugin", "debug"];

                let pluginFilter = "all";
                let levelFilter  = "all";

                // Filter bar: plugin
                const filterWrap = document.createElement("div");
                filterWrap.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-bottom:12px";

                const pluginRow = document.createElement("div");
                pluginRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center";
                const pluginLabel = document.createElement("span");
                pluginLabel.textContent   = "Plugin:";
                pluginLabel.style.cssText = "font-size:11px;color:#72767d;font-weight:600;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0";
                pluginRow.appendChild(pluginLabel);

                ALL_PLUGINS.forEach(p => {
                    const btn = document.createElement("button");
                    btn.dataset.pluginFilter = p.key;
                    btn.textContent          = p.label;
                    btn.style.cssText        = `padding:3px 10px;border-radius:4px;border:1px solid transparent;cursor:pointer;font-size:11px;font-weight:600;background:#111214;color:#72767d;transition:all .12s`;
                    btn.onclick = () => {
                        pluginFilter = p.key;
                        pluginRow.querySelectorAll("[data-plugin-filter]").forEach(b => {
                            const ap = ALL_PLUGINS.find(x => x.key === b.dataset.pluginFilter);
                            const a  = b.dataset.pluginFilter === pluginFilter;
                            b.style.background   = a ? (ap?.color ?? "#5865f2") + "22" : "#111214";
                            b.style.borderColor  = a ? (ap?.color ?? "#5865f2") + "66" : "transparent";
                            b.style.color        = a ? (ap?.color ?? "#5865f2") : "#72767d";
                        });
                        refreshLogs();
                    };
                    pluginRow.appendChild(btn);
                });

                // Filter bar: level
                const levelRow = document.createElement("div");
                levelRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center";
                const levelLabel = document.createElement("span");
                levelLabel.textContent   = "Level:";
                levelLabel.style.cssText = "font-size:11px;color:#72767d;font-weight:600;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0";
                levelRow.appendChild(levelLabel);

                LEVEL_FILTERS.forEach(lvl => {
                    const def = SpotifyEnhanced.LOG_LEVELS[lvl];
                    const col = def?.color ?? "#99aab5";
                    const btn = document.createElement("button");
                    btn.dataset.levelFilter = lvl;
                    btn.textContent         = lvl === "all" ? "✦ All" : `${def?.icon ?? ""} ${def?.label ?? lvl}`;
                    btn.style.cssText       = `padding:3px 10px;border-radius:4px;border:1px solid transparent;cursor:pointer;font-size:11px;font-weight:600;background:#111214;color:#72767d;transition:all .12s`;
                    btn.onclick = () => {
                        levelFilter = lvl;
                        levelRow.querySelectorAll("[data-level-filter]").forEach(b => {
                            const ld = SpotifyEnhanced.LOG_LEVELS[b.dataset.levelFilter];
                            const lc = ld?.color ?? "#99aab5";
                            const a  = b.dataset.levelFilter === levelFilter;
                            b.style.background  = a ? lc + "22" : "#111214";
                            b.style.borderColor = a ? lc + "66" : "transparent";
                            b.style.color       = a ? lc : "#72767d";
                        });
                        refreshLogs();
                    };
                    levelRow.appendChild(btn);
                });

                filterWrap.append(pluginRow, levelRow);
                mainContent.appendChild(filterWrap);

                // Log panel
                const logPanel = document.createElement("div");
                logPanel.style.cssText = "background:#111214;border-radius:8px;padding:8px 10px;max-height:340px;overflow-y:auto;min-height:80px;font-family:monospace;border:1px solid #2e3035";
                mainContent.appendChild(logPanel);

                // Use the full _logs buffer (all levels) not just GLOBAL_LOGS
                // We combine GLOBAL_LOGS + filter per plugin on the fly
                const getAllLogs = () => {
                    // GLOBAL_LOGS has error/warn/info/plugin; _logs has everything
                    // For "all plugins all levels" use _logs (SpotifyLyrics context)
                    // For STD-specific use GLOBAL_LOGS filtered by plugin
                    const base = [...this._logs];
                    // Merge STD-specific logs (already in _logs via _log re-routing)
                    return base.sort((a, b) => a.ts - b.ts);
                };

                const refreshLogs = () => {
                    let entries = getAllLogs();
                    if (pluginFilter !== "all")
                        entries = entries.filter(e => e.plugin === pluginFilter);
                    if (levelFilter !== "all")
                        entries = entries.filter(e => e.level === levelFilter);
                    entries = entries.slice(-120).reverse();

                    if (!entries.length) {
                        logPanel.innerHTML = `<div style="color:#72767d;font-size:12px;font-style:italic;padding:6px">No logs match the current filters.</div>`;
                        return;
                    }
                    const atBottom = logPanel.scrollTop + logPanel.clientHeight >= logPanel.scrollHeight - 12;
                    logPanel.innerHTML = entries.map(e => {
                        const pCol = ALL_PLUGINS.find(p => p.key === e.plugin)?.color ?? "#99aab5";
                        return `<div style="display:flex;gap:6px;align-items:baseline;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">
                            <span style="color:#72767d;font-size:9px;flex-shrink:0;min-width:56px">${e.time}</span>
                            <span style="font-size:10px;flex-shrink:0">${e.icon}</span>
                            <span style="font-size:10px;font-weight:700;color:${e.color};flex-shrink:0;min-width:40px">${SpotifyEnhanced.LOG_LEVELS[e.level]?.label ?? e.level}</span>
                            <span style="font-size:10px;color:${pCol};flex-shrink:0;min-width:90px">[${e.plugin}]</span>
                            <span style="font-size:11px;color:#dbdee1;word-break:break-all;line-height:1.4">${e.msg.replace(/</g,"&lt;")}</span>
                        </div>`;
                    }).join("");
                    if (atBottom) logPanel.scrollTop = logPanel.scrollHeight;
                };

                refreshLogs();
                // Activate "all" filters by default
                pluginRow.querySelector("[data-plugin-filter='all']")?.click();
                levelRow.querySelector("[data-level-filter='all']")?.click();

                const logTimer = setInterval(() => {
                    if (!mainContent.isConnected) { clearInterval(logTimer); return; }
                    refreshLogs();
                }, 1000);

                // Actions
                const actRow = document.createElement("div");
                actRow.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap";
                const clrBtn = document.createElement("button");
                clrBtn.textContent   = "🗑 Clear all logs";
                clrBtn.style.cssText = "padding:6px 14px;border-radius:6px;border:none;background:#ed424522;color:#ed4245;border:1px solid #ed424544;cursor:pointer;font-size:12px;font-weight:600";
                clrBtn.onclick = () => { this._logs.length = 0; SpotifyEnhanced.GLOBAL_LOGS.length = 0; refreshLogs(); };
                const cpyBtn = document.createElement("button");
                cpyBtn.textContent   = "📋 Copy visible";
                cpyBtn.style.cssText = "padding:6px 14px;border-radius:6px;border:none;background:#5865f222;color:#5865f2;border:1px solid #5865f244;cursor:pointer;font-size:12px;font-weight:600";
                cpyBtn.onclick = () => {
                    let entries = getAllLogs();
                    if (pluginFilter !== "all") entries = entries.filter(e => e.plugin === pluginFilter);
                    if (levelFilter  !== "all") entries = entries.filter(e => e.level === levelFilter);
                    const txt = entries.map(e => `[${e.time}] [${e.plugin}] [${e.level.toUpperCase()}] ${e.msg}`).join("\n");
                    navigator.clipboard.writeText(txt).then(() => { cpyBtn.textContent = "✓ Copied!"; setTimeout(() => { cpyBtn.textContent = "📋 Copy visible"; }, 1600); });
                };
                actRow.append(clrBtn, cpyBtn);
                mainContent.appendChild(actRow);
            }; // end renderMainLogs

            // ─── Cache ────────────────────────────────────────────────────────
            const renderMainCache = () => {
                mainContent.innerHTML = "";

                const CACHE_TABS = [
                    { key: "global", label: "🏠 Global" },
                    { key: "sl",     label: "🎵 SpotifyLyrics" },
                    { key: "std",    label: "🎤 TitleDisplay" },
                ];
                let cacheTab = "global";
                const cacheNav = document.createElement("div");
                cacheNav.style.cssText = "display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap";
                const cacheContent = document.createElement("div");

                const setCacheTab = (tab) => {
                    cacheTab = tab;
                    cacheContent.innerHTML = "";
                    cacheNav.querySelectorAll("[data-ctab]").forEach(el => {
                        const a = el.dataset.ctab === tab;
                        el.style.background   = a ? "#5865f233" : "#111214";
                        el.style.borderColor  = a ? "#5865f266" : "transparent";
                        el.style.color        = a ? "#5865f2" : "#72767d";
                        el.style.fontWeight   = a ? "700" : "400";
                    });
                    ({ global: renderCacheGlobal, sl: renderCacheSL, std: renderCacheSTD }[tab] ?? (() => {}))();
                };

                CACHE_TABS.forEach(({ key, label }) => {
                    const btn = document.createElement("button");
                    btn.dataset.ctab = key;
                    btn.textContent  = label;
                    btn.style.cssText = "padding:6px 14px;border-radius:6px;border:1px solid transparent;cursor:pointer;font-size:12px;font-weight:400;background:#111214;color:#72767d;transition:all .12s";
                    btn.onclick = () => setCacheTab(key);
                    cacheNav.appendChild(btn);
                });

                mainContent.append(cacheNav, cacheContent);

                const mkRow = (parent, label, value, col) => {
                    const r = document.createElement("div");
                    r.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px";
                    r.innerHTML = `<span style="color:#72767d">${label}</span><span style="font-family:monospace;color:${col ?? "#dbdee1"}">${value}</span>`;
                    parent.appendChild(r);
                };
                const mkSec = (title) => {
                    const sec = document.createElement("div"); sec.style.marginBottom = "18px";
                    const h   = document.createElement("div"); h.textContent = title;
                    h.style.cssText = "font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#72767d;padding-bottom:6px;border-bottom:1px solid #2e3035;margin-bottom:10px";
                    sec.appendChild(h); cacheContent.appendChild(sec); return sec;
                };
                const mkBtn = (txt, color, cb) => {
                    const b = document.createElement("button");
                    b.textContent   = txt;
                    b.style.cssText = `margin-top:8px;padding:5px 12px;border-radius:5px;border:1px solid ${color}44;background:${color}11;color:${color};cursor:pointer;font-size:11px;font-weight:600`;
                    b.onclick = cb; return b;
                };

                const renderCacheGlobal = () => {
                cacheContent.innerHTML = "";
                    const s1 = mkSec("SpotifyEnhanced");
                    mkRow(s1, "Version",          `v${SpotifyEnhanced.PLUGIN_VERSION}`, "#5865f2");
                    mkRow(s1, "Sub-plugins",       `${Object.keys(SpotifyEnhanced.SUB_PLUGINS).length}`, "#57f287");
                    mkRow(s1, "Global log buffer", `${SpotifyEnhanced.GLOBAL_LOGS.length} / ${SpotifyEnhanced.GLOBAL_LOG_MAX}`, "#fee75c");
                    mkRow(s1, "Per-plugin log buf", `${this._logs.length} / ${SpotifyEnhanced.LOG_MAX}`, "#fee75c");

                    const s2 = mkSec("User Consent");
                    Object.values(SpotifyEnhanced.SUB_PLUGINS).forEach(pl => {
                        const ok = this._consented[pl.key] ?? false;
                        mkRow(s2, `${pl.name}`, ok ? "✓ Accepted" : "✗ Not given", ok ? "#57f287" : "#ed4245");
                    });
                    s2.appendChild(mkBtn("🗑 Revoke all consents", "#ed4245", () => {
                        this._consented = {};
                        BdApi.Data.save(SpotifyEnhanced.PLUGIN_NAME, "consented", {});
                        this._log("plugin", "All consents revoked");
                        renderCacheGlobal();
                    }));
                };

                const renderCacheSL = () => {
                cacheContent.innerHTML = "";
                    const s1 = mkSec("SpotifyLyrics — Runtime");
                    const st = SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"] ?? {};
                    mkRow(s1, "Mode",           st.mode ?? "disabled", SpotifyEnhanced.MODES[st.mode ?? "disabled"]?.color);
                    mkRow(s1, "Currently playing", this._isPlaying ? "▶ Yes" : "⏹ No", this._isPlaying ? "#57f287" : "#ed4245");
                    mkRow(s1, "Track ID",       this._currentTrackId ? this._currentTrackId.slice(0,20)+"…" : "—", "#99aab5");
                    mkRow(s1, "Lyrics loaded",  this._currentLyrics ? `${this._currentLyrics.length} lines` : "—", "#57f287");
                    mkRow(s1, "Saved status",   `"${this._savedStatus?.text ?? ""}"`, "#eb459e");

                    const s2 = mkSec("SpotifyLyrics — Cache");
                    mkRow(s2, "Lyrics cache",   `${this._lyricsCache.size} / ${SpotifyEnhanced.CACHE_MAX}`, "#faa61a");
                    mkRow(s2, "In-flight fetch", `${this._prefetching.size}`, "#00b0f4");
                    mkRow(s2, "Track offsets",  `${Object.keys(this._trackOffsets).length}`, "#99aab5");
                    mkRow(s2, "History",        `${this._history.length} / ${this._settings?.historyMax ?? 20}`, "#99aab5");
                    mkRow(s2, "Blacklisted",    `${this._blacklist.size}`, "#ed4245");
                    s2.appendChild(mkBtn("🗑 Clear lyrics cache", "#faa61a", () => {
                        this._lyricsCache.clear();
                        this._log("cache", "Lyrics cache cleared");
                        renderCacheSL();
                    }));
                };

                const renderCacheSTD = () => {
                cacheContent.innerHTML = "";
                    const s1 = mkSec("SpotifyTitleDisplay — Runtime");
                    const st = SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"] ?? {};
                    mkRow(s1, "Mode",         st.mode ?? "disabled", SpotifyEnhanced.MODES[st.mode ?? "disabled"]?.color);
                    mkRow(s1, "Patch active", this._stdPatcher ? "Yes" : "No", this._stdPatcher ? "#57f287" : "#ed4245");
                    mkRow(s1, "Show artist",  this._stdShowArtist ? "Yes" : "No", "#99aab5");
                    mkRow(s1, "Max artists",  `${this._stdSettings?.maxArtists ?? 1}`, "#99aab5");
                    mkRow(s1, "Separator",    `"${this._stdSettings?.separator ?? " — "}"`, "#99aab5");
                };

                setCacheTab("global");
            }; // end renderMainCache

            // ─── Options ──────────────────────────────────────────────────────
            const renderMainOptions = () => {
                mainContent.innerHTML = "";
                const hdr = document.createElement("div");
                hdr.innerHTML = `
                    <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:6px">⚙️ SpotifyEnhanced Options</div>
                    <div style="font-size:12px;color:#72767d;margin-bottom:20px">Global settings for the SpotifyEnhanced host plugin. Per-plugin settings are in each plugin's own tab.</div>
                `;
                mainContent.appendChild(hdr);

                const aboutCard = document.createElement("div");
                aboutCard.style.cssText = "background:#111214;border-radius:10px;padding:14px 16px;margin-bottom:16px;display:grid;grid-template-columns:auto 1fr;gap:5px 16px;font-size:12px;font-family:monospace;border:1px solid #2e3035";
                [
                    ["Plugin",       SpotifyEnhanced.PLUGIN_NAME,    "#5865f2"],
                    ["Version",      `v${SpotifyEnhanced.PLUGIN_VERSION}`, "#dbdee1"],
                    ["Description",  SpotifyEnhanced.PLUGIN_DESC,    "#72767d"],
                    ["Sub-plugins",  `${Object.keys(SpotifyEnhanced.SUB_PLUGINS).length} registered`, "#57f287"],
                ].forEach(([k, v, col]) => {
                    const kEl = document.createElement("span"); kEl.textContent = k; kEl.style.color = "#72767d";
                    const vEl = document.createElement("span"); vEl.textContent = v; vEl.style.color = col;
                    aboutCard.append(kEl, vEl);
                });
                mainContent.appendChild(aboutCard);

                [
                    { icon: "🌐", title: "Language",           desc: "Change the display language. Currently only English (US) available." },
                    { icon: "🎨", title: "Theme",              desc: "Customise the colour scheme of the settings panel." },
                    { icon: "⌨️", title: "Keyboard Shortcuts", desc: "Bind keys to quickly switch plugin modes." },
                    { icon: "🔔", title: "Notifications",      desc: "Get a toast when a plugin encounters an error." },
                    { icon: "🔄", title: "Auto-Update", desc: "Fetch the latest SpotifyEnhanced from GitHub and prompt to install.", action: "autoupdate" },
                ].forEach(sec => {
                    const card = document.createElement("div");
                    card.style.cssText = "background:#111214;border-radius:8px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;border:1px solid #2e3035;opacity:.65";
                    card.innerHTML = `
                        <div>
                            <div style="font-weight:700;font-size:13px;color:#dbdee1;display:flex;align-items:center;gap:8px">
                                ${sec.icon} ${sec.title}
                                <span style="font-size:10px;padding:1px 7px;border-radius:3px;font-weight:700;background:#5865f222;color:#5865f2;border:1px solid #5865f244">COMING SOON</span>
                            </div>
                            <div style="font-size:12px;color:#72767d;margin-top:4px">${sec.desc}</div>
                        </div>
                    `;
                    mainContent.appendChild(card);
                });
            }; // end renderMainOptions

            setMainTab("plugins");
        };

                // ── SpotifyLyrics page (existing tabs) ───────────────────────────────
        const renderPluginLyrics = () => {

        // ── Tab bar ──
        const tabs    = ["Main", "Presets", "Display", "Performance", "Advanced", "Schedule", "History"];
        const tabBar  = document.createElement("div");
        tabBar.style.cssText = "display:flex;gap:2px;padding:12px 16px 0;border-bottom:2px solid var(--background-modifier-accent);flex-wrap:wrap";

        const content = document.createElement("div");
        content.style.cssText = "padding:16px";

        let activeTab = "Presets";
        const panels  = {};

        const renderTab = (name) => {
            activeTab = name;
            tabBar.querySelectorAll("[data-tab]").forEach(el => {
                const active = el.dataset.tab === name;
                el.style.background    = active ? "var(--brand-experiment)" : "transparent";
                el.style.color         = active ? "#fff" : "var(--text-muted)";
                el.style.borderRadius  = "6px 6px 0 0";
            });
            content.innerHTML = "";
            panels[name]?.();
        };

        tabs.forEach(t => {
            const btn = document.createElement("button");
            btn.dataset.tab    = t;
            btn.textContent    = t;
            btn.style.cssText  = "padding:6px 14px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;border-radius:6px 6px 0 0;background:transparent;color:var(--text-muted)";
            btn.onclick        = () => renderTab(t);
            tabBar.appendChild(btn);
        });

        pluginContainer.append(tabBar, content);

        // ── UI helpers ──
        const section = (title, parent) => {
            const w = document.createElement("div");
            w.style.cssText = "margin-bottom:20px";
            const h = document.createElement("div");
            h.textContent    = title;
            h.style.cssText  = "font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--header-secondary);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--background-modifier-accent)";
            w.appendChild(h);
            (parent ?? content).appendChild(w);
            return w;
        };

        // Descriptions <= 60 chars → shown inline, no toggle
        const SHORT_DESC = 60;
        const row = (parent, label, desc, control) => {
            const r = document.createElement("div");
            r.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);gap:16px";
            const left = document.createElement("div");
            left.style.maxWidth = "62%";
            const isShort = desc && desc.replace(/<[^>]+>/g, "").length <= SHORT_DESC;
            const isLong  = desc && !isShort;

            const labelRow = document.createElement("div");
            labelRow.style.cssText = "display:flex;align-items:center;gap:7px" + (isLong ? ";cursor:pointer" : "");
            const lbl = document.createElement("div");
            lbl.textContent   = label;
            lbl.style.cssText = "font-weight:600;font-size:13px;line-height:1.3";
            labelRow.appendChild(lbl);

            if (isShort) {
                // Inline — always visible, no toggle
                const d = document.createElement("div");
                d.innerHTML      = desc;
                d.style.cssText  = "font-size:11px;color:var(--text-muted);margin-top:3px;line-height:1.5";
                left.appendChild(labelRow);
                left.appendChild(d);
            } else if (isLong) {
                // Collapsible with animated chevron SVG
                const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                chevron.setAttribute("width", "14");
                chevron.setAttribute("height", "14");
                chevron.setAttribute("viewBox", "0 0 24 24");
                chevron.setAttribute("fill", "none");
                chevron.setAttribute("stroke", "currentColor");
                chevron.setAttribute("stroke-width", "2.5");
                chevron.setAttribute("stroke-linecap", "round");
                chevron.setAttribute("stroke-linejoin", "round");
                chevron.style.cssText = "color:var(--text-muted);transition:transform .2s cubic-bezier(.4,0,.2,1);flex-shrink:0;margin-top:1px";
                const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
                path.setAttribute("points", "6 9 12 15 18 9");
                chevron.appendChild(path);
                labelRow.appendChild(chevron);

                const d = document.createElement("div");
                d.innerHTML     = desc;
                d.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:5px;line-height:1.6;display:none;padding:6px 10px;background:rgba(255,255,255,.03);border-radius:6px;border-left:2px solid var(--brand-experiment)";

                let open = false;
                labelRow.onclick = () => {
                    open = !open;
                    d.style.display       = open ? "block" : "none";
                    chevron.style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
                };
                left.appendChild(labelRow);
                left.appendChild(d);
            } else {
                // No description
                left.appendChild(labelRow);
            }
            r.append(left, control);
            parent.appendChild(r);
            return r;
        };

        const badge = (text, color) => `<span style="background:${color}22;color:${color};border:1px solid ${color}44;border-radius:3px;padding:0 4px;font-size:10px;font-weight:700;margin-left:4px">${text}</span>`;

        const toggle = (parent, label, desc, key, cb) => {
            const inp       = document.createElement("input");
            inp.type        = "checkbox";
            inp.checked     = s[key];
            inp.style.cssText = "cursor:pointer;width:18px;height:18px;flex-shrink:0;margin-top:2px";
            inp.onchange    = () => { s[key] = inp.checked; this._saveSettings(s); cb?.(); };
            row(parent, label, desc, inp);
            return inp;
        };

        const textInput = (parent, label, desc, key, width, cb) => {
            const inp    = document.createElement("input");
            inp.type     = "text";
            inp.value    = s[key] ?? "";
            inp.style.cssText = `background:var(--input-background);color:var(--text-normal);border:1px solid var(--input-border);border-radius:6px;padding:6px 10px;width:${width ?? 140}px;flex-shrink:0;font-size:13px`;
            inp.oninput  = () => { s[key] = inp.value; this._saveSettings(s); cb?.(); };
            row(parent, label, desc, inp);
            return inp;
        };

        const numInput = (parent, label, desc, key, min, max, cb) => {
            const inp    = document.createElement("input");
            inp.type     = "number";
            inp.value    = s[key] ?? SpotifyEnhanced.DEFAULTS[key];
            inp.min      = min; inp.max = max;
            inp.style.cssText = "background:var(--input-background);color:var(--text-normal);border:1px solid var(--input-border);border-radius:6px;padding:6px 10px;width:90px;flex-shrink:0;font-size:13px";
            inp.oninput  = () => {
                const v = parseInt(inp.value, 10);
                if (!isNaN(v) && v >= min && v <= max) { s[key] = v; this._saveSettings(s); cb?.(); }
            };
            row(parent, label, desc, inp);
            return inp;
        };

        const selectInput = (parent, label, desc, key, options, cb) => {
            const sel    = document.createElement("select");
            sel.style.cssText = "background:var(--input-background);color:var(--text-normal);border:1px solid var(--input-border);border-radius:6px;padding:6px 10px;flex-shrink:0;font-size:13px;cursor:pointer";
            options.forEach(([val, lbl]) => {
                const o   = document.createElement("option");
                o.value   = val; o.textContent = lbl;
                if (s[key] === val) o.selected = true;
                sel.appendChild(o);
            });
            sel.onchange = () => { s[key] = sel.value; this._saveSettings(s); cb?.(); };
            row(parent, label, desc, sel);
            return sel;
        };

        const btn = (text, color, cb) => {
            const b = document.createElement("button");
            b.textContent    = text;
            b.style.cssText  = `padding:7px 14px;border-radius:6px;border:none;background:${color ?? "var(--background-modifier-accent)"};color:#fff;cursor:pointer;font-size:12px;font-weight:600`;
            b.onclick        = cb;
            return b;
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: MAIN (SpotifyLyrics info + quick toggle)
        // ════════════════════════════════════════════════════════════════════
        panels["Main"] = () => {
            const sec = section("🎵 SpotifyLyrics");

            const infoCard = document.createElement("div");
            infoCard.style.cssText = "background:var(--background-secondary);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px";

            const refreshInfo = () => {
                const track    = this._SpotifyStore?.getTrack?.();
                const activity = this._SpotifyStore?.getActivity?.();
                const state    = SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"];
                const uptime   = state?.startedAt && state?.enabled ? Math.round((Date.now() - state.startedAt) / 1000) : null;
                infoCard.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <div>
                            <div style="font-weight:700;font-size:16px">SpotifyLyrics <span style="font-size:11px;color:var(--text-muted);font-family:monospace;font-weight:400">v3.4.0</span></div>
                            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Real-time Spotify lyrics as Discord custom status</div>
                        </div>
                        <span style="font-size:11px;padding:3px 10px;border-radius:4px;font-weight:700;
                            background:${this._enabled ? "#57f28722" : "#ed424522"};
                            color:${this._enabled ? "#57f287" : "#ed4245"};
                            border:1px solid ${this._enabled ? "#57f28744" : "#ed424544"}">
                            ${this._enabled ? "ACTIVE" + (uptime !== null ? " · " + uptime + "s" : "") : "INACTIVE"}
                        </span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;font-family:monospace;background:rgba(0,0,0,.15);border-radius:6px;padding:10px">
                        <div><span style="color:var(--text-muted)">Track:</span> ${track?.name ?? "—"}</div>
                        <div><span style="color:var(--text-muted)">Artist:</span> ${track?.artists?.[0]?.name ?? "—"}</div>
                        <div><span style="color:var(--text-muted)">Status:</span> ${this._isPlaying ? '<span style="color:#57f287">▶ Playing</span>' : '<span style="color:#ed4245">⏹ Stopped</span>'}</div>
                        <div><span style="color:var(--text-muted)">Lyrics:</span> ${this._currentLyrics?.length ? this._currentLyrics.length + " lines" : (this._currentTrackId ? "Loading…" : "—")}</div>
                        <div><span style="color:var(--text-muted)">Preset:</span> ${SpotifyEnhanced.PRESETS[s.preset]?.label ?? s.preset}</div>
                        <div><span style="color:var(--text-muted)">Cache:</span> ${this._lyricsCache.size}/${SpotifyEnhanced.CACHE_MAX}</div>
                    </div>
                `;
            };
            refreshInfo();
            const infoTimer = setInterval(refreshInfo, 1000);
            const obs = new MutationObserver(() => { if (!infoCard.isConnected) { clearInterval(infoTimer); obs.disconnect(); } });
            obs.observe(document.body, { childList: true, subtree: true });

            sec.appendChild(infoCard);

            // Live status preview
            const livePreview = document.createElement("div");
            livePreview.style.cssText = "background:var(--background-secondary);border-radius:8px;padding:12px 14px;margin-top:10px";
            const updateLivePreview = () => {
                const cs = this._readCurrentStatus();
                const ld = this._lastDisplayedLine;
                livePreview.innerHTML = `
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:8px;font-family:monospace">LIVE STATUS PREVIEW</div>
                    <div style="display:flex;align-items:center;gap:10px">
                        <div style="width:36px;height:36px;border-radius:50%;background:var(--background-modifier-accent);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
                            ${cs?.emojiName ? cs.emojiName : "💬"}
                        </div>
                        <div style="flex:1;min-width:0">
                            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-normal)">
                                ${cs?.text ? cs.text.replace(/</g,"&lt;") : '<span style="color:var(--text-muted);font-style:italic">No custom status</span>'}
                            </div>
                            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                                ${ld ? `Current lyric: "<i>${ld.text.replace(/</g,"&lt;")}</i>"` : (this._isPlaying ? "Playing — no lyric active" : "Not playing")}
                            </div>
                        </div>
                    </div>
                `;
            };
            updateLivePreview();
            const lpTimer = setInterval(updateLivePreview, 1000);
            const lpObs = new MutationObserver(() => { if (!livePreview.isConnected) { clearInterval(lpTimer); lpObs.disconnect(); } });
            lpObs.observe(document.body, { childList: true, subtree: true });
            sec.appendChild(livePreview);

            // Quick enable/disable
            const togRow = document.createElement("div");
            togRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--background-modifier-accent);margin-top:10px";
            const togLabel = document.createElement("span");
            togLabel.textContent   = "Enable SpotifyLyrics";
            togLabel.style.cssText = "font-weight:600;font-size:13px";
            const togInp = document.createElement("input");
            togInp.type      = "checkbox";
            togInp.checked   = this._enabled;
            togInp.style.cssText = "cursor:pointer;width:18px;height:18px";
            togInp.onchange  = () => {
                if (togInp.checked && !this._consented["spotifylyrics"]) {
                    togInp.checked = false;
                    this._showConsentModal("spotifylyrics", () => { togInp.checked = true; SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"] = { enabled: true, startedAt: Date.now(), stoppedAt: null }; this._enableSpotifyLyrics(); });
                    return;
                }
                SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"] = { enabled: togInp.checked, startedAt: togInp.checked ? Date.now() : SpotifyEnhanced.PLUGIN_STATES["spotifylyrics"]?.startedAt, stoppedAt: togInp.checked ? null : Date.now() };
                if (!togInp.checked) this._disableSpotifyLyrics();
                else                 this._enableSpotifyLyrics();
            };
            togRow.append(togLabel, togInp);
            sec.appendChild(togRow);
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: PRESETS
        // ════════════════════════════════════════════════════════════════════
        panels["Presets"] = () => {
            const sec = section("⚡ Choose a Preset");

            Object.entries(SpotifyEnhanced.PRESETS).forEach(([key, preset]) => {
                const card = document.createElement("div");
                const active = s.preset === key;
                card.style.cssText = `
                    padding:14px 16px;border-radius:8px;border:2px solid;
                    cursor:pointer;margin-bottom:10px;transition:all .15s;
                    background:${active ? "rgba(88,101,242,.15)" : "var(--background-secondary)"};
                    border-color:${active ? "var(--brand-experiment)" : "var(--background-modifier-accent)"};
                `;
                card.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <div style="font-weight:700;font-size:15px">${preset.label}${active ? badge("ACTIVE", "#57f287") : ""}</div>
                        <div style="font-size:11px;color:var(--text-muted);font-family:monospace">
                            poll: ${preset.pollInterval}ms &nbsp;|&nbsp; throttle: ${preset.statusUpdateThrottle}ms
                        </div>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${preset.description}</div>
                `;
                card.onclick = () => {
                    this._applyPreset(key);
                    renderTab("Presets");
                };
                sec.appendChild(card);
            });

            // Live Status
            const stat = section("📊 Live Status");

            // Current Discord status display
            const statusDisp = document.createElement("div");
            statusDisp.style.cssText = "background:var(--background-secondary);border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:10px;display:flex;align-items:center;gap:10px";
            const statusDot = document.createElement("div");
            statusDot.style.cssText = "width:8px;height:8px;border-radius:50%;flex-shrink:0";
            const statusTxt = document.createElement("div");
            statusTxt.style.cssText = "font-family:monospace;flex:1;word-break:break-all";
            statusDisp.append(statusDot, statusTxt);
            stat.appendChild(statusDisp);

            const box  = document.createElement("div");
            box.style.cssText = "background:var(--background-secondary);border-radius:8px;padding:12px 14px;font-size:12px;font-family:monospace;display:grid;grid-template-columns:1fr 1fr;gap:6px";

            const refreshBox = () => {
                const track    = this._SpotifyStore?.getTrack?.();
                const activity = this._SpotifyStore?.getActivity?.();
                const lines    = this._currentLyrics?.length ?? 0;
                const pos      = activity?.timestamps?.start ? Math.round((Date.now() - activity.timestamps.start) / 1000) : 0;
                // Live current status from Discord
                const curStatus = this._readCurrentStatus();
                const hasStatus = !!(curStatus?.text);
                statusDot.style.background = hasStatus ? "#57f287" : "#99aab5";
                statusDot.style.boxShadow  = hasStatus ? "0 0 6px #57f28799" : "none";
                statusTxt.innerHTML = hasStatus
                    ? `<span style="color:var(--text-muted);font-size:10px">Current status: </span><b>${curStatus.text.replace(/</g,"&lt;")}</b>`
                    : `<span style="color:var(--text-muted);font-style:italic">No custom status set</span>`;
                const items = [
                    ["Status",    this._isPlaying ? '<span style="color:#57f287">▶ Playing</span>' : '<span style="color:#ed4245">⏹ Stopped</span>'],
                    ["Track",     track?.name ?? "—"],
                    ["Artist",    track?.artists?.[0]?.name ?? "—"],
                    ["Position",  this._isPlaying ? `${pos}s` : "—"],
                    ["Lyrics",    lines > 0 ? `${lines} lines` : (this._currentTrackId ? "Loading…" : "—")],
                    ["Cache",     `${this._lyricsCache.size}/${SpotifyEnhanced.CACHE_MAX}`],
                    ["Preset",    SpotifyEnhanced.PRESETS[s.preset]?.label ?? s.preset],
                    ["Poll",      `${s.pollInterval}ms`],
                    ["Offset",    `${(this._trackOffsets[track?.id] ?? 0) + (s.lyricsOffsetMs ?? 0)}ms`],
                    ["Schedule",  s.scheduleEnabled ? `${s.scheduleFrom}→${s.scheduleTo}` : "Disabled"],
                ];
                box.innerHTML = items.map(([k, v]) =>
                    `<div><span style="color:var(--text-muted)">${k}:</span> ${v}</div>`
                ).join("");
            };
            refreshBox();
            if (this._statusRefreshTimer) clearInterval(this._statusRefreshTimer);
            this._statusRefreshTimer = setInterval(refreshBox, 1000);
            const lsObs = new MutationObserver(() => { if (!box.isConnected) { clearInterval(this._statusRefreshTimer); this._statusRefreshTimer = null; lsObs.disconnect(); } });
            lsObs.observe(document.body, { childList: true, subtree: true });

            stat.append(box);

            // Test / Restore buttons
            let testStatusSaved = null;
            const btnRowLS = document.createElement("div");
            btnRowLS.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap";

            const testB = btn("🧪 Test Status", "#5865f2", () => {
                // Save current status before overwriting
                testStatusSaved = this._readCurrentStatus();
                this._lastSentStatus = null; // force update
                this._applyStatus("🎵 Test SpotifyEnhanced v3.4.0", this._settings.statusEmoji?.trim() || null, true);
                this._log("info", "Test status sent — original saved for restore");
                restoreB.style.opacity = "1";
                restoreB.style.pointerEvents = "auto";
            });

            const restoreB = btn("↩ Restore Status", "#57f287", () => {
                if (testStatusSaved) {
                    this._lastSentStatus = null;
                    this._applyStatus(testStatusSaved.text, testStatusSaved.emojiName, true);
                    this._log("info", `Status restored: "${testStatusSaved.text}"`);
                    testStatusSaved = null;
                    restoreB.style.opacity = "0.4";
                    restoreB.style.pointerEvents = "none";
                }
            });
            restoreB.style.opacity = "0.4";
            restoreB.style.pointerEvents = "none";

            btnRowLS.append(testB, restoreB);
            stat.appendChild(btnRowLS);
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: AFFICHAGE
        // ════════════════════════════════════════════════════════════════════
        panels["Display"] = () => {
            const sec = section("🎨 Format & Text");

            textInput(sec, "Status Format",
                `Status template. Variables: <code>{emoji}</code> <code>{lyric}</code> <code>{artist}</code> <code>{track}</code><br>
                Ex: <code>{emoji} {lyric}</code> → 🎶 Never gonna give you up<br>
                Ex: <code>{lyric} — {artist}</code> → Never gonna give you up — Rick Astley`,
                "statusFormat", 200);

            textInput(sec, "Status Emoji",
                "Emoji shown in the status. Leave blank to disable.",
                "statusEmoji", 60);

            textInput(sec, "Instrumental Text",
                "Shown during sections without lyrics (gaps detected automatically).",
                "instrumentalText", 160);

            numInput(sec, "Max Status Length (chars)",
                "Discord allows max 128 characters. Recommended value: 128.",
                "truncateLength", 10, 128);

            toggle(sec, "Show Repeat Counter",
                "Appends <b>(x2)</b>, <b>(x3)</b>… when the same line repeats consecutively.",
                "showRepeatCount");

            toggle(sec, "Skip Empty Lines",
                "Skip lines marked empty in the LRC file.",
                "skipEmptyLines");

            const sec2 = section("📺 Track Header");

            toggle(sec2, "Show Track Name Before Lyrics",
                "Shows <b>Track — Artist</b> while lyrics are loading.",
                "showTrackNameBeforeLyrics");

            numInput(sec2, "Header Duration (ms)",
                `After this delay with no lyrics shown, automatically switches to instrumental text.<br>
                Min: 1000ms &nbsp;|&nbsp; Recommended: 5000ms`,
                "trackNameDuration", 1000, 30000);

            const sec3 = section("📭 Fallback — No Lyrics");

            selectInput(sec3, "Action When No Lyrics Found",
                "What to show when LRCLIB finds no synced lyrics for the current track.",
                "fallbackNoLyrics",
                [["track", "Show Track — Artist"], ["custom", "Custom Text"], ["none", "Show Nothing"]],
                () => renderTab("Display")
            );

            if (s.fallbackNoLyrics === "custom") {
                textInput(sec3, "Custom Fallback Text",
                    "Text shown when no lyrics are available for the current track.",
                    "fallbackCustomText", 200);
            }

            toggle(sec3, "Track Name Only Mode (no lyrics)",
                "Disables LRCLIB entirely. Shows only <b>Track — Artist</b> continuously. Zero external requests.",
                "lyricsOnlyMode");
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: PERFORMANCE
        // ════════════════════════════════════════════════════════════════════
        panels["Performance"] = () => {
            const sec = section("⚙️ Frequencies");

            numInput(sec, "Poll Interval (ms)",
                `How often the plugin checks Spotify and updates lyrics.<br>
                <b>Hard min: 200ms</b> — risk of client lag below that.<br>
                Discreet: <b>1000–2000ms</b> &nbsp;|&nbsp; Reactive: <b>500–700ms</b>`,
                "pollInterval", 200, 5000, () => this._startPoll());

            numInput(sec, "Status Update Throttle (ms)",
                `Minimum delay between two Discord status API calls.<br>
                Too low = detection risk. <b>Recommended min: 800ms</b>.<br>
                Discreet: <b>2000–3000ms</b> &nbsp;|&nbsp; Reactive: <b>800–1000ms</b>`,
                "statusUpdateThrottle", 200, 10000);

            numInput(sec, "Queue Prefetch Delay (ms)",
                `How often the plugin queries Spotify to prefetch the next track's lyrics.<br>
                External request to Spotify (not Discord). <b>Recommended min: 15000ms</b>.<br>
                Recommended: <b>30000ms</b>`,
                "queuePrefetchDelay", 5000, 120000);

            numInput(sec, "LRCLIB Request Timeout (ms)",
                `Max delay before giving up on a request to lrclib.net.<br>
                Recommended: <b>10000–12000ms</b>. Too low = failures on slow connections.`,
                "lrclibTimeout", 2000, 30000);

            numInput(sec, "Auto Instru Gap (ms)",
                `If silence between two lines exceeds this threshold, automatically shows instrumental text.<br>
                Independent of LRCLIB — local detection based on LRC timestamps.<br>
                Recommended: <b>6000–10000ms</b>`,
                "autoInstruGap", 1000, 60000);
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: AVANCÉ
        // ════════════════════════════════════════════════════════════════════
        panels["Advanced"] = () => {
            const sec = section("🔧 LRCLIB & Sync");

            toggle(sec, "LRCLIB Search Fallback",
                "If direct lookup (track + artist) fails, tries a text search on LRCLIB. Increases chances of finding lyrics but makes an extra request.",
                "lrclibFallbackSearch");

            numInput(sec, "Global Lyrics Offset (ms)",
                `Shifts all lyrics in time. Positive = lyrics come earlier, negative = lyrics come later.<br>
                Useful if LRCLIB is consistently ahead or behind.<br>
                For a specific track, use the per-track offset in the Cache tab.`,
                "lyricsOffsetMs", -10000, 10000);

            const sec2 = section("🛡️ Protection");

            toggle(sec2, "DND Protection",
                "Does not update status when you are in <b>Do Not Disturb</b> mode. Useful during calls or work sessions.",
                "dndProtect");

            const sec3 = section("📤 Export / Import Config");

            const expBtn = btn("📤 Export Config", "#5865f2", () => {
                const data = JSON.stringify({ settings: s, trackOffsets: this._trackOffsets, blacklist: [...this._blacklist] }, null, 2);
                const blob = new Blob([data], { type: "application/json" });
                const a    = document.createElement("a");
                a.href     = URL.createObjectURL(blob);
                a.download = "SpotifyLyrics-config.json";
                a.click();
                this._log("info", "Config exported");
            });

            const impInput = document.createElement("input");
            impInput.type  = "file";
            impInput.accept = ".json";
            impInput.style.display = "none";
            impInput.onchange = async () => {
                try {
                    const text = await impInput.files[0].text();
                    const data = JSON.parse(text);
                    if (data.settings)     { Object.assign(s, data.settings); this._saveSettings(s); }
                    if (data.trackOffsets) { this._trackOffsets = data.trackOffsets; BdApi.Data.save(SpotifyEnhanced.PLUGIN_NAME, "trackOffsets", this._trackOffsets); }
                    if (data.blacklist)    { this._blacklist = new Set(data.blacklist); BdApi.Data.save(SpotifyEnhanced.PLUGIN_NAME, "blacklist", [...this._blacklist]); }
                    this._log("info", "Config imported successfully");
                    renderTab("Advanced");
                } catch (e) {
                    this._log("error", `Import failed: ${e.message}`);
                }
            };

            const impBtn = btn("📥 Import Config", "#57f287", () => impInput.click());

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display:flex;gap:8px;margin-top:10px";
            btnRow.append(expBtn, impBtn, impInput);
            sec3.appendChild(btnRow);

            const sec4 = section("🐛 Debug");
            toggle(sec4, "Debug Console Logs",
                "Enables verbose logs in the Discord client DevTools console.",
                "debugLogs");
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: PLANNING
        // ════════════════════════════════════════════════════════════════════
        panels["Schedule"] = () => {
            const sec = section("🕐 Active Time Window");

            toggle(sec, "Enable Schedule",
                "The plugin only updates the status between the hours defined below. Outside the window, the original status is restored.",
                "scheduleEnabled", () => renderTab("Schedule"));

            if (s.scheduleEnabled) {
                textInput(sec, "Start Time",
                    "Format HH:MM (24h). e.g. <b>08:00</b>",
                    "scheduleFrom", 80);
                textInput(sec, "End Time",
                    "Format HH:MM (24h). e.g. <b>23:00</b>",
                    "scheduleTo", 80);

                const now  = new Date();
                const cur  = now.getHours() * 60 + now.getMinutes();
                const inS  = this._isInSchedule();
                const info = document.createElement("div");
                info.style.cssText = `margin-top:8px;padding:8px 12px;border-radius:6px;font-size:12px;background:${inS ? "#57f28722" : "#ed424522"};color:${inS ? "#57f287" : "#ed4245"}`;
                info.textContent   = inS
                    ? `✅ Plugin active — ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`
                    : `⏸ Plugin paused — outside schedule ${s.scheduleFrom} → ${s.scheduleTo}`;
                sec.appendChild(info);
            }
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: HISTORIQUE
        // ════════════════════════════════════════════════════════════════════
        panels["History"] = () => {
            const sec = section("📜 Listening History");

            toggle(sec, "Enable History",
                "Enregistre les tracks écoutés pendant la session.",
                "historyEnabled");

            numInput(sec, "Nombre de tracks à conserver",
                "Nombre maximum de tracks dans l'historique. Min: 5, Max: 100.",
                "historyMax", 5, 100);

            const list = document.createElement("div");
            list.style.cssText = "margin-top:12px;display:flex;flex-direction:column;gap:4px";

            if (!this._history.length) {
                list.innerHTML = `<div style="color:var(--text-muted);font-size:12px;font-style:italic;padding:8px">No tracks in history yet.</div>`;
            } else {
                this._history.forEach((h, i) => {
                    const card = document.createElement("div");
                    card.style.cssText = "background:var(--background-secondary);border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px";
                    const ago  = Math.round((Date.now() - h.at) / 60000);
                    const agoS = ago < 1 ? "just now" : ago < 60 ? ` ${ago}min` : ` ${Math.round(ago/60)}h`;
                    card.innerHTML = `
                        <div style="font-size:12px">
                            <span style="font-weight:600">${h.name}</span>
                            <span style="color:var(--text-muted)"> — ${h.artist}</span>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
                            <span style="font-size:10px;color:var(--text-muted)">${agoS}</span>
                        </div>
                    `;

                    // Blacklist button
                    const blBtn = btn(this._blacklist.has(h.id) ? "✅ Allowed" : "🚫 Ignore",
                        this._blacklist.has(h.id) ? "#57f287" : "#ed4245", () => {
                        if (this._blacklist.has(h.id)) {
                            this._blacklist.delete(h.id);
                            this._log("info", `Removed from blacklist: "${h.name}"`);
                        } else {
                            this._blacklist.add(h.id);
                            this._log("info", `Blacklisted: "${h.name}"`);
                        }
                        BdApi.Data.save(SpotifyEnhanced.PLUGIN_NAME, "blacklist", [...this._blacklist]);
                        renderTab("History");
                    });
                    blBtn.style.fontSize = "11px";
                    blBtn.style.padding  = "4px 8px";
                    card.querySelector("div:last-child").appendChild(blBtn);
                    list.appendChild(card);
                });
            }

            sec.appendChild(list);

            const clearH = btn("🗑 Clear History", "#ed4245", () => {
                this._history = [];
                BdApi.Data.save(SpotifyEnhanced.PLUGIN_NAME, "history", []);
                this._log("info", "History cleared");
                renderTab("History");
            });
            clearH.style.marginTop = "10px";
            sec.appendChild(clearH);
        };

        // ── Render initial tab
        renderTab("Main");

        }; // end renderPluginLyrics

                // ── SpotifyTitleDisplay settings page ─────────────────────────────────
        const renderPluginSTD = () => {
            // STD state (persisted in class, not BD.Data for now)
            if (!this._stdSettings) {
                this._stdSettings = {
                    separator:   " — ",
                    maxArtists:  1,   // 1..5 or 99=all
                    showTitle:   true,
                    showAlbum:   false,
                    prefix:      "",
                    suffix:      "",
                };
            }
            const ss = this._stdSettings;

            // Inner tab system
            const stdTabs = ["Main", "Display"];
            let stdActiveTab = "Main";

            const wrap = document.createElement("div");
            wrap.style.cssText = "font-size:14px;color:var(--text-normal)";
            pluginContainer.appendChild(wrap);

            const stdTabBar = document.createElement("div");
            stdTabBar.style.cssText = "display:flex;gap:0;padding:0 16px;border-bottom:2px solid var(--background-modifier-accent)";
            const stdContent = document.createElement("div");
            stdContent.style.cssText = "padding:16px";
            wrap.append(stdTabBar, stdContent);

            const renderSTDTab = (tab) => {
                stdActiveTab = tab;
                stdContent.innerHTML = "";
                stdTabBar.querySelectorAll("[data-stdtab]").forEach(el => {
                    const a = el.dataset.stdtab === tab;
                    el.style.color        = a ? "var(--text-normal)" : "var(--text-muted)";
                    el.style.borderBottom = a ? "2px solid var(--brand-experiment)" : "2px solid transparent";
                    el.style.fontWeight   = a ? "700" : "500";
                    el.style.marginBottom = "-2px";
                });
                if (tab === "Main")    renderSTDMain();
                if (tab === "Display") renderSTDDisplay();
            };

            stdTabs.forEach(t => {
                const tb = document.createElement("button");
                tb.dataset.stdtab = t;
                tb.textContent    = t;
                tb.style.cssText  = "background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-muted);cursor:pointer;font-size:13px;font-weight:500;padding:10px 14px;margin-bottom:-2px;transition:color .15s";
                tb.onclick        = () => renderSTDTab(t);
                stdTabBar.appendChild(tb);
            });

            // Shared helpers
            const stdSec = (title) => {
                const w = document.createElement("div"); w.style.cssText = "margin-bottom:18px";
                const h = document.createElement("div"); h.textContent = title;
                h.style.cssText = "font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--header-secondary);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--background-modifier-accent)";
                w.appendChild(h); stdContent.appendChild(w); return w;
            };
            const stdRow = (parent, label, desc, ctrl) => {
                const r = document.createElement("div");
                r.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);gap:16px";
                const left = document.createElement("div"); left.style.maxWidth = "65%";
                const lbl = document.createElement("div"); lbl.textContent = label; lbl.style.cssText = "font-weight:600;font-size:13px";
                left.appendChild(lbl);
                if (desc) { const d = document.createElement("div"); d.textContent = desc; d.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:3px"; left.appendChild(d); }
                r.append(left, ctrl); parent.appendChild(r);
            };
            const stdToggle = (parent, label, desc, getter, setter) => {
                const inp = document.createElement("input"); inp.type = "checkbox"; inp.checked = getter();
                inp.style.cssText = "cursor:pointer;width:18px;height:18px;flex-shrink:0";
                inp.onchange = () => { setter(inp.checked); updateSTDPreview(); };
                stdRow(parent, label, desc, inp); return inp;
            };
            const stdSelect = (parent, label, desc, getter, setter, opts) => {
                const sel = document.createElement("select");
                sel.style.cssText = "background:var(--input-background);color:var(--text-normal);border:1px solid var(--input-border);border-radius:6px;padding:6px 10px;font-size:13px;cursor:pointer";
                opts.forEach(([v,l]) => { const o = document.createElement("option"); o.value=v; o.textContent=l; if(getter()===v||getter()==v) o.selected=true; sel.appendChild(o); });
                sel.onchange = () => { setter(sel.value); updateSTDPreview(); };
                stdRow(parent, label, desc, sel); return sel;
            };
            const stdText = (parent, label, desc, getter, setter, w) => {
                const inp = document.createElement("input"); inp.type="text"; inp.value=getter();
                inp.style.cssText = `background:var(--input-background);color:var(--text-normal);border:1px solid var(--input-border);border-radius:6px;padding:6px 10px;width:${w??120}px;font-size:13px`;
                inp.oninput = () => { setter(inp.value); updateSTDPreview(); };
                stdRow(parent, label, desc, inp); return inp;
            };

            // Live preview (shared, updated by all controls)
            let previewTimer = null;
            const previewEl = document.createElement("div");

            const updateSTDPreview = () => {
                const track    = this._SpotifyStore?.getTrack?.();
                const activity = this._SpotifyStore?.getActivity?.();
                const title    = track?.name ?? "Song Title";
                // Discord separates multiple artists with "; " in activity.state
                const allArtists = (activity?.state ?? "Artist One; Artist Two; Artist Three").split(/;\s*|,\s*/).map(a => a.trim()).filter(Boolean);
                const maxA       = parseInt(ss.maxArtists ?? 1, 10);
                const artists    = maxA >= 99 ? allArtists : allArtists.slice(0, maxA);
                const artistStr  = artists.join(", ");

                let display = "";
                if (ss.showTitle) display += title;
                if (this._stdShowArtist && artistStr) {
                    if (display) display += ss.separator;
                    display += artistStr;
                }
                if (ss.showAlbum && track?.album?.name) display += ` (${track.album.name})`;
                display = (ss.prefix ?? "") + display + (ss.suffix ?? "");

                previewEl.innerHTML = `
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:10px;font-family:monospace">
                        LIVE PREVIEW ${track ? '· <span style="color:#1db954">Spotify connected ✓</span>' : '· <span style="color:var(--text-muted)">No track playing</span>'}
                    </div>
                    <div style="background:var(--background-tertiary,var(--background-secondary));border-radius:10px;padding:14px;display:flex;align-items:center;gap:12px;border:1px solid var(--background-modifier-accent)">
                        <div style="width:44px;height:44px;border-radius:6px;background:#1db95422;border:1px solid #1db95444;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🎵</div>
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:700;font-size:13px;color:var(--text-normal)">Spotify</div>
                            <div style="font-size:12px;color:var(--text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${display.replace(/"/g,"&quot;")}">
                                ${display.replace(/</g,"&lt;") || '<span style="font-style:italic;opacity:.5">empty</span>'}
                            </div>
                        </div>
                    </div>
                    <div style="margin-top:8px;font-size:11px;color:var(--text-muted);font-family:monospace">
                        Before: <span style="color:#ed4245">${(activity?.state ?? "artist name").replace(/</g,"&lt;")}</span>
                        &nbsp;→&nbsp; After: <span style="color:#57f287">${display.replace(/</g,"&lt;") || "(empty)"}</span>
                    </div>
                `;
            };

            // ── STD Main tab ────────────────────────────────────────────────
            const renderSTDMain = () => {
                const secInfo = stdSec("🎤 SpotifyTitleDisplay");
                const state   = SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"];
                const uptime  = state?.startedAt && state?.enabled ? Math.round((Date.now() - state.startedAt) / 1000) : null;
                const infoBox = document.createElement("div");
                infoBox.style.cssText = "background:var(--background-secondary);border-radius:8px;padding:14px;margin-bottom:12px";
                infoBox.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <div>
                            <span style="font-weight:700;font-size:15px">${SpotifyEnhanced.SUB_PLUGINS.spotifytitledisplay.name}</span>
                            <span style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-left:8px">v${SpotifyEnhanced.SUB_PLUGINS.spotifytitledisplay.version}</span>
                        </div>
                        <span style="font-size:11px;padding:2px 8px;border-radius:4px;font-weight:700;
                            background:${this._stdEnabled ? "#57f28722" : "#ed424522"};
                            color:${this._stdEnabled ? "#57f287" : "#ed4245"};
                            border:1px solid ${this._stdEnabled ? "#57f28744" : "#ed424544"}">
                            <span data-std-status>${this._stdEnabled ? "ACTIVE" + (uptime !== null ? " · " + uptime + "s" : "") : "INACTIVE"}</span>
                        </span>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted)">Replaces the artist name with the song title on Spotify statuses in Discord. Shows other users what you're listening to by name rather than who made it.</div>
                `;
                const infoRefreshTimer = setInterval(() => {
                    if (!infoBox.isConnected) { clearInterval(infoRefreshTimer); return; }
                    const st2 = SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"];
                    const ut2 = st2?.startedAt && st2?.enabled ? Math.round((Date.now() - st2.startedAt) / 1000) : null;
                    const badgeEl = infoBox.querySelector("[data-std-status]");
                    if (badgeEl) badgeEl.textContent = this._stdEnabled ? "ACTIVE" + (ut2 !== null ? " · " + ut2 + "s" : "") : "INACTIVE";
                }, 1000);
                secInfo.appendChild(infoBox);

                const enTog = document.createElement("input"); enTog.type="checkbox"; enTog.checked=this._stdEnabled;
                enTog.style.cssText = "cursor:pointer;width:18px;height:18px;flex-shrink:0";
                enTog.onchange = () => {
                    if (enTog.checked && !this._consented["spotifytitledisplay"]) {
                        enTog.checked = false;
                        this._showConsentModal("spotifytitledisplay", () => {
                            enTog.checked = true;
                            SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"] = { enabled: true, startedAt: Date.now(), stoppedAt: null };
                            this._stdEnabled = true; this._startSTD();
                            this._log("plugin", "SpotifyTitleDisplay enabled");
                        });
                        return;
                    }
                    SpotifyEnhanced.PLUGIN_STATES["spotifytitledisplay"] = { enabled: enTog.checked, startedAt: enTog.checked ? Date.now() : state?.startedAt, stoppedAt: enTog.checked ? null : Date.now() };
                    this._stdEnabled = enTog.checked;
                    if (this._stdEnabled) this._startSTD();
                    else                  this._stopSTD();
                    this._log("plugin", `SpotifyTitleDisplay ${this._stdEnabled ? "enabled" : "disabled"}`);
                };
                stdRow(secInfo, "Enable SpotifyTitleDisplay", "Toggle the plugin on/off without reloading.", enTog);

                // Preview in Main tab too
                updateSTDPreview();
                secInfo.appendChild(previewEl);
                previewTimer = setInterval(updateSTDPreview, 2000);
                const pObs = new MutationObserver(() => { if (!wrap.isConnected) { clearInterval(previewTimer); pObs.disconnect(); } });
                pObs.observe(document.body, { childList: true, subtree: true });
            };

            // ── STD Display tab ─────────────────────────────────────────────
            const renderSTDDisplay = () => {
                const sec1 = stdSec("🎵 Title & Artist");

                stdToggle(sec1, "Show Song Title",
                    "Include the song title in the display.",
                    () => ss.showTitle, v => ss.showTitle = v);

                stdToggle(sec1, "Show Artist Name",
                    "Include artist name(s) after the title.",
                    () => this._stdShowArtist, v => { this._stdShowArtist = v; });

                stdSelect(sec1, "Number of Artists to Show",
                    "How many artists to include when a track has multiple featured artists.",
                    () => String(ss.maxArtists), v => ss.maxArtists = v,
                    [["1","First only"],["2","First 2"],["3","First 3"],["4","First 4"],["5","First 5"],["99","All artists"]]);

                stdText(sec1, "Artist Separator",
                    "Character(s) between title and artist.",
                    () => ss.separator, v => ss.separator = v, 80);

                const sec2 = stdSec("📝 Extra Info");

                stdToggle(sec2, "Show Album Name",
                    "Append the album name in parentheses.",
                    () => ss.showAlbum, v => ss.showAlbum = v);

                stdText(sec2, "Prefix",
                    "Text added before everything.",
                    () => ss.prefix, v => ss.prefix = v, 100);

                stdText(sec2, "Suffix",
                    "Text added after everything.",
                    () => ss.suffix, v => ss.suffix = v, 100);

                const sec3 = stdSec("👁 Live Preview");
                updateSTDPreview();
                sec3.appendChild(previewEl);
                previewTimer = setInterval(updateSTDPreview, 2000);
                const pObs = new MutationObserver(() => { if (!wrap.isConnected) { clearInterval(previewTimer); pObs.disconnect(); } });
                pObs.observe(document.body, { childList: true, subtree: true });
            };

            // Also update _startSTD to use stdSettings
            renderSTDTab("Main");
        };

        // Initial render — default to Main
        renderPluginPage("main");
        return root;
    }

    // ─── Preset apply ─────────────────────────────────────────────────────────

    _applyPreset(key) {
        const preset = SpotifyEnhanced.PRESETS[key];
        if (!preset) return;
        Object.assign(this._settings, preset, { preset: key });
        this._saveSettings(this._settings);
        this._startPoll();
        this._log("preset", `Preset applied: ${preset.label}`);
    }

    // ─── Settings helpers ─────────────────────────────────────────────────────

    _loadSettings() {
        const saved = BdApi.Data.load(SpotifyEnhanced.PLUGIN_NAME, "settings") ?? {};
        return Object.assign({}, SpotifyEnhanced.DEFAULTS, saved);
    }

    _saveSettings(s) {
        this._settings = s;
        BdApi.Data.save(SpotifyEnhanced.PLUGIN_NAME, "settings", s);
    }

    // ─── State reset ──────────────────────────────────────────────────────────

    _resetState() {
        this._currentTrackId    = null;
        this._currentLyrics     = null;
        this._lastDisplayedLine = null;
        this._trackHeaderShown  = false;
        this._trackHeaderTimer  = null;
        this._isPlaying         = false;
        this._repeatCount       = 0;
        this._repeatText        = null;
        this._autoInstruShown   = false;
        this._lastStatusUpdate  = 0;
        this._statusSaved       = false;
        this._savedStatus       = null;
        this._lyricsCache.clear();
        this._prefetching.clear();
        this._logPanel          = null;
        this._stdPatcher        = null;
        if (this._statusRefreshTimer) { clearInterval(this._statusRefreshTimer); this._statusRefreshTimer = null; }
    }
};
