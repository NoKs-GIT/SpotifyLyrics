/**
 * @name SpotifyLyrics
 * @author noks.pm
 * @description Displays Spotify lyrics as your Discord custom status in real time.
 * @version 3.0.0
 */

module.exports = class SpotifyLyrics {

    // ─── Constants ────────────────────────────────────────────────────────────

    static PLUGIN_NAME     = "SpotifyLyrics";
    static LRCLIB_BASE     = "https://lrclib.net/api";
    static CACHE_MAX       = 15;
    static CACHE_TTL       = 30 * 60 * 1000;
    static INSTRUMENTAL_RE = /^[♪♫*\-~\s]+$/;
    static LOG_MAX         = 200;
    static HISTORY_DEFAULT = 20;

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
    };

    // ─── Presets ──────────────────────────────────────────────────────────────

    static PRESETS = {
        safe: {
            label:                "🛡️ Safe",
            description:          "Polling lent, appels Discord réduits au minimum. Recommandé si tu veux rester discret à tout prix.",
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
            description:          "Réglages par défaut. Bon équilibre réactivité / discrétion. Recommandé pour la plupart des usages.",
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
            description:          "Polling très rapide, paroles quasi-instantanées. Génère plus de trafic interne. Moins discret.",
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
        statusFormat:              "{emoji} {lyric}",
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
        const def   = SpotifyLyrics.LOG_LEVELS[level] ?? SpotifyLyrics.LOG_LEVELS.info;
        const entry = {
            ts:    Date.now(),
            time:  new Date().toLocaleTimeString("fr-FR", { hour12: false }),
            level,
            icon:  def.icon,
            color: def.color,
            msg,
            extra: extra ?? null,
        };
        this._logs.push(entry);
        if (this._logs.length > SpotifyLyrics.LOG_MAX) this._logs.shift();
        if (this._logPanel) this._renderLogs();
        if (this._settings?.debugLogs) {
            const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.debug;
            fn(`[SpotifyLyrics:${def.label}] ${msg}`, extra ?? "");
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
            this._logPanel.innerHTML = `<div style="color:var(--text-muted);font-size:12px;font-style:italic;padding:8px">Aucun log${filter !== "all" ? ` pour le filtre "${filter}"` : ""}</div>`;
            return;
        }

        this._logPanel.innerHTML = entries.map(e => `
            <div style="display:flex;gap:6px;align-items:baseline;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.04)">
                <span style="color:var(--text-muted);font-size:10px;flex-shrink:0;font-family:monospace">${e.time}</span>
                <span style="font-size:10px;flex-shrink:0">${e.icon}</span>
                <span style="font-size:10px;font-weight:700;color:${e.color};flex-shrink:0;min-width:46px">${SpotifyLyrics.LOG_LEVELS[e.level]?.label ?? e.level}</span>
                <span style="font-size:11px;color:var(--text-normal);word-break:break-all">${e.msg.replace(/</g, "&lt;")}</span>
            </div>
        `).join("");
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start() {
        this._settings     = this._loadSettings();
        this._trackOffsets = BdApi.Data.load(SpotifyLyrics.PLUGIN_NAME, "trackOffsets") ?? {};
        this._blacklist    = new Set(BdApi.Data.load(SpotifyLyrics.PLUGIN_NAME, "blacklist") ?? []);
        this._history      = BdApi.Data.load(SpotifyLyrics.PLUGIN_NAME, "history") ?? [];
        this._resolveDiscordModules();
        const initial = this._readCurrentStatus();
        if (initial !== null) this._savedStatus = initial;
        this._startPoll();
        this._log("info", `Plugin démarré — v3.0.0 — preset: ${this._settings.preset}`);
    }

    stop() {
        this._stopPoll();
        if (this._trackHeaderTimer) clearTimeout(this._trackHeaderTimer);
        if (this._statusRefreshTimer) clearInterval(this._statusRefreshTimer);
        this._restoreStatus();
        this._resetState();
        this._log("info", "Plugin arrêté");
    }

    _startPoll() {
        this._stopPoll();
        this._pollTimer = setInterval(() => this._tick(), this._settings.pollInterval ?? 700);
        this._log("debug", `Poll démarré — interval: ${this._settings.pollInterval}ms`);
    }

    _stopPoll() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
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
            this._log("error", "SpotifyStore introuvable — Spotify doit être connecté à Discord");

        const candidates = BdApi.Webpack.getModules(
            m => typeof m?.updateAsync === "function",
            { searchExports: true }
        ) ?? [];
        this._UserSettingsUpdater = candidates.find(
            m => m.ProtoClass?.fields?.some(f => f.name === "status")
        ) ?? null;

        if (!this._UserSettingsUpdater)
            this._log("error", "UserSettingsUpdater introuvable — mise à jour statut impossible");
        else
            this._log("info", "Modules Discord résolus avec succès");
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
            this._log("status", `Statut sauvegardé → "${current.text}"`);
        }
        this._statusSaved = true;
    }

    _restoreStatus() {
        const text  = this._savedStatus?.text      ?? "";
        const emoji = this._savedStatus?.emojiName ?? null;
        this._applyStatus(text, emoji, true);
        this._statusSaved = false;
        this._log("status", `Statut restauré → "${text}"`);
    }

    _applyStatus(text, emojiName, force = false) {
        if (!this._UserSettingsUpdater) return;
        // DND protection
        if (this._settings.dndProtect && this._isDndActive()) {
            this._log("warn", "DND actif — mise à jour statut ignorée");
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
        try {
            this._UserSettingsUpdater.updateAsync("status", draft => {
                draft.customStatus = {
                    text:        truncated,
                    emojiName:   emojiName ?? "",
                    emojiId:     "0",
                    expiresAtMs: "0",
                };
            });
            this._log("status", `→ "${truncated}"`);
        } catch (e) {
            this._log("error", `updateAsync failed: ${e.message}`);
        }
    }

    _formatStatus(lyric, artist, trackName) {
        const emoji  = this._settings.statusEmoji?.trim() ?? "";
        const tpl    = this._settings.statusFormat ?? "{emoji} {lyric}";
        return tpl
            .replace("{emoji}",  emoji)
            .replace("{lyric}",  lyric)
            .replace("{artist}", artist ?? "")
            .replace("{track}",  trackName ?? "")
            .trim();
    }

    _setLyricStatus(lyric, artist, trackName) {
        const emoji = this._settings.statusEmoji?.trim() || null;
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
        const url = `${SpotifyLyrics.LRCLIB_BASE}/get?${p}`;
        this._log("network", `GET ${url}`);
        const res = await fetch(url, { signal: AbortSignal.timeout(this._settings.lrclibTimeout ?? 12000) });
        if (res.status === 404) { this._log("network", "LRCLIB 404 — pas de résultat direct"); return null; }
        if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
        return res.json();
    }

    async _lrclibSearch(trackName, artistName) {
        const p   = new URLSearchParams({ q: `${trackName} ${artistName}`.trim() });
        const url = `${SpotifyLyrics.LRCLIB_BASE}/search?${p}`;
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
        this._log("network", `Fetch paroles: "${trackName}" — "${artistName}"`);
        let data = null;
        try { data = await this._lrclibGet(trackName, artistName); } catch (e) { this._log("warn", `lrclibGet (avec artiste) failed: ${e.message}`); }
        if (!data) {
            try { data = await this._lrclibGet(trackName); } catch (e) { this._log("warn", `lrclibGet (sans artiste) failed: ${e.message}`); }
        }
        if (!data && this._settings.lrclibFallbackSearch) {
            try { data = await this._lrclibSearch(trackName, artistName); } catch (e) { this._log("warn", `lrclibSearch failed: ${e.message}`); }
        }
        if (!data?.syncedLyrics) {
            this._log("warn", `Pas de paroles synchronisées pour "${trackName}"`);
            return null;
        }
        const lines = this._parseLrc(data.syncedLyrics);
        this._log("cache", `Paroles parsées — ${lines.length} lignes pour "${trackName}"`);
        return lines;
    }

    // ─── Cache ────────────────────────────────────────────────────────────────

    _getCached(id) {
        const e = this._lyricsCache.get(id);
        if (!e) return null;
        if (Date.now() - e.cachedAt > SpotifyLyrics.CACHE_TTL) { this._lyricsCache.delete(id); return null; }
        return e;
    }

    _setCache(id, lyrics) {
        if (this._lyricsCache.size >= SpotifyLyrics.CACHE_MAX) {
            const oldest = [...this._lyricsCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
            this._lyricsCache.delete(oldest[0]);
            this._log("cache", `Cache plein — éviction: ${oldest[0]}`);
        }
        this._lyricsCache.set(id, { lyrics, cachedAt: Date.now() });
        this._log("cache", `Cache set — id: ${id} (${this._lyricsCache.size}/${SpotifyLyrics.CACHE_MAX})`);
    }

    _prefetchTrack(id, name, artist) {
        if (this._getCached(id) || this._prefetching.has(id)) return;
        this._prefetching.add(id);
        this._log("cache", `Prefetch: "${name}"`);
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
            this._log("spotify", "Fetch queue Spotify...");
            const res = await fetch("https://api.spotify.com/v1/me/player/queue", {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) { this._log("warn", `Queue fetch HTTP ${res.status}`); return; }
            const data = await res.json();
            const next = data?.queue?.[0];
            if (next?.id) {
                this._log("spotify", `Prochain titre détecté: "${next.name}" — prefetch...`);
                this._prefetchTrack(next.id, next.name, next.artists?.[0]?.name ?? "");
            } else {
                this._log("spotify", "Queue vide ou pas de titre suivant");
            }
        } catch (e) { this._log("warn", `Queue prefetch error: ${e.message}`); }
    }

    // ─── History ──────────────────────────────────────────────────────────────

    _addHistory(track) {
        if (!this._settings.historyEnabled) return;
        const max = this._settings.historyMax ?? SpotifyLyrics.HISTORY_DEFAULT;
        this._history = this._history.filter(h => h.id !== track.id);
        this._history.unshift({
            id:     track.id,
            name:   track.name,
            artist: track.artists?.[0]?.name ?? "",
            at:     Date.now(),
        });
        if (this._history.length > max) this._history = this._history.slice(0, max);
        BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "history", this._history);
        this._log("info", `Historique mis à jour — ${this._history.length} titres`);
    }

    // ─── Instrumental / format ────────────────────────────────────────────────

    _isInstrumental(text) { return SpotifyLyrics.INSTRUMENTAL_RE.test(text.trim()); }
    _formatLine(text)     { return this._isInstrumental(text) ? this._settings.instrumentalText : text; }

    // ─── Main tick ────────────────────────────────────────────────────────────

    async _tick() {
        // Schedule check
        if (!this._isInSchedule()) {
            if (this._isPlaying) {
                this._isPlaying = false;
                this._restoreStatus();
                this._log("info", "Hors plage horaire — statut restauré");
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
                this._log("spotify", "Lecture arrêtée / mise en pause");
                this._restoreStatus();
            }
            return;
        }

        // ── BLACKLIST ─────────────────────────────────────────────────────────
        if (this._blacklist.has(track.id)) {
            this._log("debug", `Titre blacklisté ignoré: "${track.name}"`);
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
            this._log("spotify", `Nouveau titre: "${track.name}" — "${artist}"${prevId ? ` (précédent: ${prevId})` : ""}`);
            this._addHistory(track);

            // Show track name header immediately
            if (this._settings.showTrackNameBeforeLyrics && !this._settings.lyricsOnlyMode) {
                const headerText = this._formatStatus(`${track.name} — ${artist}`, artist, track.name);
                this._applyStatus(headerText, this._settings.statusEmoji?.trim() || null);
                this._trackHeaderShown = true;
                this._log("status", `Header affiché: "${track.name} — ${artist}"`);

                // Auto-hide header after trackNameDuration ms if still no lyrics
                const dur = this._settings.trackNameDuration ?? 5000;
                this._trackHeaderTimer = setTimeout(() => {
                    if (this._currentTrackId === track.id && !this._lastDisplayedLine) {
                        // Still no lyric shown → show instru
                        const instrText = this._formatStatus(this._settings.instrumentalText, artist, track.name);
                        this._applyStatus(instrText, this._settings.statusEmoji?.trim() || null);
                        this._log("status", `Header expiré (${dur}ms) sans paroles → instru`);
                    }
                    this._trackHeaderTimer = null;
                }, dur);
            }

            // Load lyrics (cache-first)
            const cached = this._getCached(track.id);
            if (cached) {
                this._currentLyrics = cached.lyrics;
                this._log("cache", `Paroles depuis cache pour "${track.name}"`);
            } else {
                const capturedId = track.id;
                this._fetchLyrics(track.name, artist)
                    .then(lyrics => {
                        this._setCache(capturedId, lyrics);
                        if (capturedId === this._currentTrackId) {
                            this._currentLyrics = lyrics;
                            this._log("lyric", `Paroles chargées (async): ${lyrics?.length ?? 0} lignes`);
                        }
                    })
                    .catch(e => {
                        this._log("error", `Fetch paroles échoué: ${e.message}`);
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
            this._log("spotify", "Lecture reprise");
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
                this._log("lyric", "Aucune ligne active (avant premières paroles) → instru auto");
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
                    this._log("lyric", `Gap ${Math.round((nextLine.time - currentLine.time) / 1000)}s détecté → instru auto`);
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

                this._log("lyric", `[${Math.round(position / 1000)}s] "${display}"${this._repeatCount > 1 ? ` (répétition x${this._repeatCount})` : ""}`);
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

        // ── Tab bar ──
        const tabs    = ["Presets", "Affichage", "Performance", "Avancé", "Planning", "Historique", "Cache", "Logs"];
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

        root.append(tabBar, content);

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

        const row = (parent, label, desc, control) => {
            const r = document.createElement("div");
            r.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);gap:16px";
            const left = document.createElement("div");
            left.style.maxWidth = "60%";
            const lbl = document.createElement("div");
            lbl.textContent    = label;
            lbl.style.cssText  = "font-weight:600;font-size:13px";
            left.appendChild(lbl);
            if (desc) {
                const d = document.createElement("div");
                d.innerHTML      = desc;
                d.style.cssText  = "font-size:11px;color:var(--text-muted);margin-top:3px;line-height:1.5";
                left.appendChild(d);
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
            inp.value    = s[key] ?? SpotifyLyrics.DEFAULTS[key];
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
        // TAB: PRESETS
        // ════════════════════════════════════════════════════════════════════
        panels["Presets"] = () => {
            const sec = section("⚡ Choisir un preset");

            Object.entries(SpotifyLyrics.PRESETS).forEach(([key, preset]) => {
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
                        <div style="font-weight:700;font-size:15px">${preset.label}${active ? badge("ACTIF", "#57f287") : ""}</div>
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

            // Status actuel
            const stat = section("📊 État en temps réel");
            const box  = document.createElement("div");
            box.style.cssText = "background:var(--background-secondary);border-radius:8px;padding:12px 14px;font-size:12px;font-family:monospace;display:grid;grid-template-columns:1fr 1fr;gap:6px";

            const refreshBox = () => {
                const track    = this._SpotifyStore?.getTrack?.();
                const activity = this._SpotifyStore?.getActivity?.();
                const lines    = this._currentLyrics?.length ?? 0;
                const pos      = activity?.timestamps?.start ? Math.round((Date.now() - activity.timestamps.start) / 1000) : 0;
                const items = [
                    ["Statut",     this._isPlaying ? '<span style="color:#57f287">▶ En lecture</span>' : '<span style="color:#ed4245">⏹ Arrêté</span>'],
                    ["Titre",      track ? `${track.name}` : "—"],
                    ["Artiste",    track?.artists?.[0]?.name ?? "—"],
                    ["Position",   this._isPlaying ? `${pos}s` : "—"],
                    ["Paroles",    lines > 0 ? `${lines} lignes` : (this._currentTrackId ? "Chargement…" : "—")],
                    ["Cache",      `${this._lyricsCache.size}/${SpotifyLyrics.CACHE_MAX}`],
                    ["Preset",     SpotifyLyrics.PRESETS[s.preset]?.label ?? "custom"],
                    ["Poll",       `${s.pollInterval}ms`],
                    ["Offset",     `${(this._trackOffsets[track?.id] ?? 0) + (s.lyricsOffsetMs ?? 0)}ms`],
                    ["Planner",    s.scheduleEnabled ? `${s.scheduleFrom}→${s.scheduleTo}` : "Désactivé"],
                ];
                box.innerHTML = items.map(([k, v]) =>
                    `<div><span style="color:var(--text-muted)">${k}:</span> ${v}</div>`
                ).join("");
            };
            refreshBox();
            if (this._statusRefreshTimer) clearInterval(this._statusRefreshTimer);
            this._statusRefreshTimer = setInterval(refreshBox, 2000);

            stat.append(box);

            const testB = btn("🧪 Tester le statut", "#5865f2", () => {
                this._setLyricStatus("🎵 Test SpotifyLyrics v3", "Artiste", "Titre test");
                this._log("info", "Test statut envoyé depuis le panel");
            });
            testB.style.marginTop = "10px";
            stat.appendChild(testB);
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: AFFICHAGE
        // ════════════════════════════════════════════════════════════════════
        panels["Affichage"] = () => {
            const sec = section("🎨 Format & texte");

            textInput(sec, "Format du statut",
                `Template du statut. Variables: <code>{emoji}</code> <code>{lyric}</code> <code>{artist}</code> <code>{track}</code><br>
                Ex: <code>{emoji} {lyric}</code> → 🎶 Never gonna give you up<br>
                Ex: <code>{lyric} — {artist}</code> → Never gonna give you up — Rick Astley`,
                "statusFormat", 200);

            textInput(sec, "Emoji de statut",
                "Emoji affiché dans le statut. Laisse vide pour en désactiver un.",
                "statusEmoji", 60);

            textInput(sec, "Texte instrumental",
                "Affiché pendant les sections sans paroles (gaps détectés automatiquement).",
                "instrumentalText", 160);

            numInput(sec, "Longueur max du statut (chars)",
                "Discord accepte max 128 caractères. Valeur recommandée: 128.",
                "truncateLength", 10, 128);

            toggle(sec, "Afficher compteur de répétitions",
                "Ajoute <b>(x2)</b>, <b>(x3)</b>… quand une même ligne se répète consécutivement.",
                "showRepeatCount");

            toggle(sec, "Ignorer les lignes vides",
                "Ne pas afficher les lignes instrumentales marquées vides dans le LRC.",
                "skipEmptyLines");

            const sec2 = section("📺 En-tête de titre");

            toggle(sec2, "Afficher le nom du titre avant les paroles",
                "Affiche <b>Titre — Artiste</b> pendant le chargement des paroles.",
                "showTrackNameBeforeLyrics");

            numInput(sec2, "Durée de l'en-tête (ms)",
                `Après ce délai sans paroles affichées, bascule automatiquement sur le texte instrumental.<br>
                Min: 1000ms &nbsp;|&nbsp; Recommandé: 5000ms`,
                "trackNameDuration", 1000, 30000);

            const sec3 = section("📭 Fallback si pas de paroles");

            selectInput(sec3, "Action si aucune parole trouvée",
                "Ce qui s'affiche quand LRCLIB ne trouve aucune parole synchronisée pour le titre en cours.",
                "fallbackNoLyrics",
                [["track", "Afficher Titre — Artiste"], ["custom", "Texte personnalisé"], ["none", "Ne rien afficher"]],
                () => renderTab("Affichage")
            );

            if (s.fallbackNoLyrics === "custom") {
                textInput(sec3, "Texte fallback personnalisé",
                    "Texte affiché quand aucune parole n'est disponible pour le titre en cours.",
                    "fallbackCustomText", 200);
            }

            toggle(sec3, "Mode titre seulement (sans paroles)",
                "Désactive LRCLIB complètement. Affiche uniquement <b>Titre — Artiste</b> en continu. Zéro requête externe.",
                "lyricsOnlyMode");
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: PERFORMANCE
        // ════════════════════════════════════════════════════════════════════
        panels["Performance"] = () => {
            const sec = section("⚙️ Fréquences");

            numInput(sec, "Intervalle de poll (ms)",
                `Fréquence à laquelle le plugin vérifie Spotify et met à jour les paroles.<br>
                <b>Min absolu: 200ms</b> — risque de lag client en dessous.<br>
                Recommandé discret: <b>1000–2000ms</b> &nbsp;|&nbsp; Recommandé réactif: <b>500–700ms</b>`,
                "pollInterval", 200, 5000, () => this._startPoll());

            numInput(sec, "Throttle mise à jour statut (ms)",
                `Délai minimum entre deux appels à l'API statut Discord.<br>
                Trop bas = risque de détection. <b>Min recommandé: 800ms</b>.<br>
                Recommandé discret: <b>2000–3000ms</b> &nbsp;|&nbsp; Recommandé réactif: <b>800–1000ms</b>`,
                "statusUpdateThrottle", 200, 10000);

            numInput(sec, "Délai prefetch queue (ms)",
                `Fréquence à laquelle le plugin interroge Spotify pour précharger les paroles du titre suivant.<br>
                Requête externe vers Spotify (pas Discord). <b>Min recommandé: 15000ms</b>.<br>
                Recommandé: <b>30000ms</b>`,
                "queuePrefetchDelay", 5000, 120000);

            numInput(sec, "Timeout requête LRCLIB (ms)",
                `Délai max avant d'abandonner une requête vers lrclib.net.<br>
                Recommandé: <b>10000–12000ms</b>. Trop bas = échecs sur connexion lente.`,
                "lrclibTimeout", 2000, 30000);

            numInput(sec, "Gap instru auto (ms)",
                `Si un silence entre deux lignes dépasse ce seuil, affiche automatiquement le texte instrumental.<br>
                Ne dépend pas de LRCLIB — détection locale basée sur les timestamps LRC.<br>
                Recommandé: <b>6000–10000ms</b>`,
                "autoInstruGap", 1000, 60000);
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: AVANCÉ
        // ════════════════════════════════════════════════════════════════════
        panels["Avancé"] = () => {
            const sec = section("🔧 LRCLIB & Sync");

            toggle(sec, "Fallback recherche LRCLIB",
                "Si la lookup directe (titre + artiste) échoue, tente une recherche textuelle sur LRCLIB. Augmente les chances de trouver des paroles mais fait une requête supplémentaire.",
                "lrclibFallbackSearch");

            numInput(sec, "Offset global des paroles (ms)",
                `Décale toutes les paroles dans le temps. Positif = avance les paroles, négatif = les retarde.<br>
                Utile si LRCLIB est systématiquement en avance ou en retard.<br>
                Pour un titre spécifique, utilise l'offset par titre dans l'onglet Cache.`,
                "lyricsOffsetMs", -10000, 10000);

            const sec2 = section("🛡️ Protection");

            toggle(sec2, "Protection DND",
                "Ne met pas à jour le statut quand tu es en mode <b>Ne pas déranger</b>. Pratique pour les appels ou les sessions de travail.",
                "dndProtect");

            const sec3 = section("📤 Export / Import config");

            const expBtn = btn("📤 Exporter la config", "#5865f2", () => {
                const data = JSON.stringify({ settings: s, trackOffsets: this._trackOffsets, blacklist: [...this._blacklist] }, null, 2);
                const blob = new Blob([data], { type: "application/json" });
                const a    = document.createElement("a");
                a.href     = URL.createObjectURL(blob);
                a.download = "SpotifyLyrics-config.json";
                a.click();
                this._log("info", "Config exportée");
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
                    if (data.trackOffsets) { this._trackOffsets = data.trackOffsets; BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "trackOffsets", this._trackOffsets); }
                    if (data.blacklist)    { this._blacklist = new Set(data.blacklist); BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "blacklist", [...this._blacklist]); }
                    this._log("info", "Config importée avec succès");
                    renderTab("Avancé");
                } catch (e) {
                    this._log("error", `Import échoué: ${e.message}`);
                }
            };

            const impBtn = btn("📥 Importer une config", "#57f287", () => impInput.click());

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display:flex;gap:8px;margin-top:10px";
            btnRow.append(expBtn, impBtn, impInput);
            sec3.appendChild(btnRow);

            const sec4 = section("🐛 Debug");
            toggle(sec4, "Logs debug console",
                "Active les logs détaillés dans la console DevTools du client Discord.",
                "debugLogs");
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: PLANNING
        // ════════════════════════════════════════════════════════════════════
        panels["Planning"] = () => {
            const sec = section("🕐 Plage horaire active");

            toggle(sec, "Activer le planning",
                "Le plugin ne met à jour le statut qu'entre les heures définies ci-dessous. En dehors de la plage, le statut original est restauré.",
                "scheduleEnabled", () => renderTab("Planning"));

            if (s.scheduleEnabled) {
                textInput(sec, "Heure de début",
                    "Format HH:MM (24h). Ex: <b>08:00</b>",
                    "scheduleFrom", 80);
                textInput(sec, "Heure de fin",
                    "Format HH:MM (24h). Ex: <b>23:00</b>",
                    "scheduleTo", 80);

                const now  = new Date();
                const cur  = now.getHours() * 60 + now.getMinutes();
                const inS  = this._isInSchedule();
                const info = document.createElement("div");
                info.style.cssText = `margin-top:8px;padding:8px 12px;border-radius:6px;font-size:12px;background:${inS ? "#57f28722" : "#ed424522"};color:${inS ? "#57f287" : "#ed4245"}`;
                info.textContent   = inS
                    ? `✅ Plugin actif — il est ${now.getHours()}:${String(now.getMinutes()).padStart(2,"0")}`
                    : `⏸ Plugin en pause — hors de la plage ${s.scheduleFrom}→${s.scheduleTo}`;
                sec.appendChild(info);
            }
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: HISTORIQUE
        // ════════════════════════════════════════════════════════════════════
        panels["Historique"] = () => {
            const sec = section("📜 Historique d'écoute");

            toggle(sec, "Activer l'historique",
                "Enregistre les titres écoutés pendant la session.",
                "historyEnabled");

            numInput(sec, "Nombre de titres à conserver",
                "Nombre maximum de titres dans l'historique. Min: 5, Max: 100.",
                "historyMax", 5, 100);

            const list = document.createElement("div");
            list.style.cssText = "margin-top:12px;display:flex;flex-direction:column;gap:4px";

            if (!this._history.length) {
                list.innerHTML = `<div style="color:var(--text-muted);font-size:12px;font-style:italic;padding:8px">Aucun titre dans l'historique.</div>`;
            } else {
                this._history.forEach((h, i) => {
                    const card = document.createElement("div");
                    card.style.cssText = "background:var(--background-secondary);border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px";
                    const ago  = Math.round((Date.now() - h.at) / 60000);
                    const agoS = ago < 1 ? "à l'instant" : ago < 60 ? `il y a ${ago}min` : `il y a ${Math.round(ago/60)}h`;
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
                    const blBtn = btn(this._blacklist.has(h.id) ? "✅ Autorisé" : "🚫 Ignorer",
                        this._blacklist.has(h.id) ? "#57f287" : "#ed4245", () => {
                        if (this._blacklist.has(h.id)) {
                            this._blacklist.delete(h.id);
                            this._log("info", `Retiré de la blacklist: "${h.name}"`);
                        } else {
                            this._blacklist.add(h.id);
                            this._log("info", `Blacklisté: "${h.name}"`);
                        }
                        BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "blacklist", [...this._blacklist]);
                        renderTab("Historique");
                    });
                    blBtn.style.fontSize = "11px";
                    blBtn.style.padding  = "4px 8px";
                    card.querySelector("div:last-child").appendChild(blBtn);
                    list.appendChild(card);
                });
            }

            sec.appendChild(list);

            const clearH = btn("🗑 Vider l'historique", "#ed4245", () => {
                this._history = [];
                BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "history", []);
                this._log("info", "Historique vidé");
                renderTab("Historique");
            });
            clearH.style.marginTop = "10px";
            sec.appendChild(clearH);
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: CACHE
        // ════════════════════════════════════════════════════════════════════
        panels["Cache"] = () => {
            const sec = section("📦 Paroles en cache");

            if (!this._lyricsCache.size) {
                sec.innerHTML += `<div style="color:var(--text-muted);font-size:12px;font-style:italic;padding:8px 0">Cache vide.</div>`;
            } else {
                [...this._lyricsCache.entries()].forEach(([id, entry]) => {
                    const card = document.createElement("div");
                    card.style.cssText = "background:var(--background-secondary);border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:12px";
                    const hist = this._history.find(h => h.id === id);
                    const age  = Math.round((Date.now() - entry.cachedAt) / 60000);
                    const off  = this._trackOffsets[id] ?? 0;
                    card.innerHTML = `
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                            <div>
                                <div style="font-weight:600">${hist?.name ?? id}</div>
                                <div style="color:var(--text-muted);margin-top:2px">
                                    ${entry.lyrics ? `${entry.lyrics.length} lignes` : "Pas de paroles"} &nbsp;|&nbsp; En cache depuis ${age}min
                                    &nbsp;|&nbsp; Offset: <b>${off >= 0 ? "+" : ""}${off}ms</b>
                                </div>
                            </div>
                        </div>
                    `;

                    const btnRow = document.createElement("div");
                    btnRow.style.cssText = "display:flex;gap:6px;margin-top:8px;align-items:center";

                    // Offset input for this track
                    const offInp = document.createElement("input");
                    offInp.type  = "number";
                    offInp.value = off;
                    offInp.style.cssText = "background:var(--input-background);color:var(--text-normal);border:1px solid var(--input-border);border-radius:4px;padding:4px 8px;width:80px;font-size:11px";
                    offInp.placeholder = "offset ms";

                    const saveOff = btn("💾 Sauver offset", "#5865f2", () => {
                        const v = parseInt(offInp.value, 10);
                        if (!isNaN(v)) {
                            this._trackOffsets[id] = v;
                            BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "trackOffsets", this._trackOffsets);
                            this._log("info", `Offset sauvegardé pour ${id}: ${v}ms`);
                        }
                    });
                    saveOff.style.fontSize = "11px";
                    saveOff.style.padding  = "4px 8px";

                    const delBtn = btn("🗑", "#ed4245", () => {
                        this._lyricsCache.delete(id);
                        delete this._trackOffsets[id];
                        BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "trackOffsets", this._trackOffsets);
                        this._log("cache", `Cache invalidé pour: ${id}`);
                        renderTab("Cache");
                    });
                    delBtn.style.fontSize = "11px";
                    delBtn.style.padding  = "4px 8px";

                    btnRow.append(offInp, saveOff, delBtn);
                    card.appendChild(btnRow);
                    sec.appendChild(card);
                });
            }

            const clearAll = btn("🗑 Vider tout le cache", "#ed4245", () => {
                this._lyricsCache.clear();
                this._log("cache", "Cache entièrement vidé");
                renderTab("Cache");
            });
            clearAll.style.marginTop = "10px";
            sec.appendChild(clearAll);

            // Track offsets section
            const secOff = section("🎚 Offsets par titre sauvegardés");
            const saved = Object.keys(this._trackOffsets);
            if (!saved.length) {
                secOff.innerHTML += `<div style="color:var(--text-muted);font-size:12px;font-style:italic">Aucun offset sauvegardé.</div>`;
            } else {
                saved.forEach(id => {
                    const h   = this._history.find(x => x.id === id);
                    const off = this._trackOffsets[id];
                    const r   = document.createElement("div");
                    r.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px;gap:8px";
                    r.innerHTML = `<span>${h?.name ?? id}</span><span style="color:var(--text-muted)">${off >= 0 ? "+" : ""}${off}ms</span>`;
                    const del = btn("✖", "#ed4245", () => {
                        delete this._trackOffsets[id];
                        BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "trackOffsets", this._trackOffsets);
                        renderTab("Cache");
                    });
                    del.style.cssText = "padding:2px 8px;font-size:11px;border-radius:4px;border:none;background:#ed4245;color:#fff;cursor:pointer";
                    r.appendChild(del);
                    secOff.appendChild(r);
                });

                const resetAll = btn("↺ Reset tous les offsets", "#fee75c", () => {
                    this._trackOffsets = {};
                    BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "trackOffsets", {});
                    renderTab("Cache");
                });
                resetAll.style.marginTop = "8px";
                secOff.appendChild(resetAll);
            }
        };

        // ════════════════════════════════════════════════════════════════════
        // TAB: LOGS
        // ════════════════════════════════════════════════════════════════════
        panels["Logs"] = () => {
            const sec = section("📋 Logs en temps réel");

            // Filter bar
            const filterBar = document.createElement("div");
            filterBar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px";

            const levels = ["all", ...Object.keys(SpotifyLyrics.LOG_LEVELS)];
            levels.forEach(lvl => {
                const def    = SpotifyLyrics.LOG_LEVELS[lvl];
                const active = (s.logFilter ?? "all") === lvl;
                const b      = document.createElement("button");
                b.textContent    = def ? `${def.icon} ${def.label}` : "✦ TOUS";
                b.style.cssText  = `
                    padding:4px 10px;border-radius:4px;border:1px solid;cursor:pointer;font-size:11px;font-weight:600;
                    background:${active ? (def?.color ?? "#fff") + "33" : "transparent"};
                    color:${def?.color ?? "var(--text-normal)"};
                    border-color:${active ? (def?.color ?? "#fff") : "var(--background-modifier-accent)"};
                `;
                b.onclick = () => {
                    s.logFilter = lvl;
                    this._saveSettings(s);
                    if (this._logFilterEl) this._logFilterEl = null;
                    renderTab("Logs");
                };
                filterBar.appendChild(b);
            });
            sec.appendChild(filterBar);

            // Log panel
            const panel = document.createElement("div");
            panel.style.cssText = "background:var(--background-secondary);border-radius:8px;padding:10px 12px;max-height:380px;overflow-y:auto;min-height:100px";
            this._logPanel = panel;
            this._renderLogs();
            sec.appendChild(panel);

            // Action buttons
            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap";

            const clearB = btn("🗑 Vider les logs", "#ed4245", () => {
                this._logs = [];
                this._renderLogs();
            });
            const copyB = btn("📋 Copier", "#5865f2", () => {
                const text = this._logs.map(e => `[${e.time}] [${e.level.toUpperCase()}] ${e.msg}`).join("\n");
                navigator.clipboard.writeText(text).then(() => {
                    this._log("info", "Logs copiés dans le presse-papiers");
                });
            });
            btnRow.append(clearB, copyB);
            sec.appendChild(btnRow);
        };

        // ── Render initial tab
        renderTab("Presets");
        return root;
    }

    // ─── Preset apply ─────────────────────────────────────────────────────────

    _applyPreset(key) {
        const preset = SpotifyLyrics.PRESETS[key];
        if (!preset) return;
        Object.assign(this._settings, preset, { preset: key });
        this._saveSettings(this._settings);
        this._startPoll();
        this._log("preset", `Preset appliqué: ${preset.label}`);
    }

    // ─── Settings helpers ─────────────────────────────────────────────────────

    _loadSettings() {
        const saved = BdApi.Data.load(SpotifyLyrics.PLUGIN_NAME, "settings") ?? {};
        return Object.assign({}, SpotifyLyrics.DEFAULTS, saved);
    }

    _saveSettings(s) {
        this._settings = s;
        BdApi.Data.save(SpotifyLyrics.PLUGIN_NAME, "settings", s);
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
        if (this._statusRefreshTimer) { clearInterval(this._statusRefreshTimer); this._statusRefreshTimer = null; }
    }
};