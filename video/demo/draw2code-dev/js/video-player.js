// Video player for this site: the controls drawn over each video file (a
// <div class="video-player">, styled by video-player.css), so a video looks
// and works the same in every browser.
//
// Everything the player shows is already in the page: the big Play button,
// the bar with Play, the time line, the time, Mute, the volume and Full
// screen, and a line for a message. This script never adds or removes any
// of it. It only sets attributes and text, and the values of the two
// sliders, so the page stays exactly as it was written. A page that cannot
// run it keeps the browser's own controls, which the script takes away.
//
// Keys work while a control of the player has the focus: Space or K plays
// and pauses, Left and Right move 5 seconds, Up and Down change the volume,
// M mutes, F goes full screen, Home and End go to the start and the end.

(function () {
    'use strict';

    /** How long the controls stay while playing after the pointer last moved, in ms. */
    const IDLE_AFTER = 2500;
    /** How far Left and Right move, in seconds. */
    const SKIP = 5;
    /** How much Up and Down change the volume (0 to 1). */
    const VOLUME_STEP = 0.1;
    /** The time line's slider goes from 0 to this. */
    const SEEK_MAX = 1000;
    /** A video's networkState once none of its files is left to try (HTMLMediaElement.NETWORK_NO_SOURCE). */
    const NO_SOURCE = 3;
    /** How long after the script starts a video found with no file left is looked at again, in ms. */
    const SETTLE = 500;

    /** 65 -> "1:05"; an hour or more -> "1:02:03". A time not known yet is 0:00. */
    function clock(seconds) {
        const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = String(total % 60).padStart(2, '0');
        return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + secs : minutes + ':' + secs;
    }

    /** Set or take away an attribute that only says yes or no. */
    function flag(el, name, on) {
        if (on) el.setAttribute(name, '');
        else el.removeAttribute(name);
    }

    function setUp(box) {
        const video = box.querySelector('video');
        if (!video) return;
        const find = (cls) => box.querySelector('.' + cls);
        const bigPlay = find('video-big-play');
        const play = find('video-play');
        const seek = find('video-seek');
        const time = find('video-time');
        const mute = find('video-mute');
        const volume = find('video-volume');
        const full = find('video-full');
        const message = find('video-message');

        // From here on these controls are the video's, not the browser's.
        box.setAttribute('data-ready', '');
        video.removeAttribute('controls');

        // ---- playing --------------------------------------------------
        function toggle() {
            if (video.paused || video.ended) {
                // A browser may refuse (no sound allowed yet, a file it
                // cannot play): the error event says so, not this.
                const started = video.play();
                if (started && started.catch) started.catch(() => {});
            } else {
                video.pause();
            }
        }

        function showPlaying() {
            const playing = !video.paused && !video.ended;
            flag(box, 'data-playing', playing);
            if (play) play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            if (playing) stillLater();
            else awake();
        }

        for (const button of [bigPlay, play]) if (button) button.addEventListener('click', toggle);
        video.addEventListener('click', toggle);
        video.addEventListener('play', showPlaying);
        video.addEventListener('pause', showPlaying);
        video.addEventListener('ended', showPlaying);

        // ---- the time -------------------------------------------------
        function showTime() {
            const now = video.currentTime;
            const length = video.duration;
            const known = Number.isFinite(length) && length > 0;
            if (seek) {
                seek.value = String(known ? Math.round((now / length) * SEEK_MAX) : 0);
                seek.setAttribute('aria-valuetext', clock(now) + ' of ' + clock(length));
            }
            if (time) time.textContent = clock(now) + ' / ' + clock(length);
        }

        /** Go to a time in seconds, kept inside the video. */
        function goTo(seconds) {
            const length = video.duration;
            if (!Number.isFinite(length) || length <= 0) return;
            video.currentTime = Math.max(0, Math.min(length, seconds));
            showTime();
        }

        for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked']) video.addEventListener(event, showTime);
        if (seek) seek.addEventListener('input', () => goTo((Number(seek.value) / SEEK_MAX) * video.duration));

        // ---- sound ----------------------------------------------------
        function showSound() {
            const silent = video.muted || video.volume === 0;
            flag(box, 'data-muted', silent);
            if (mute) mute.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
            if (volume) volume.value = String(silent ? 0 : video.volume);
        }

        function toggleMute() {
            if (video.muted || video.volume === 0) {
                video.muted = false;
                // Turned all the way down, unmuting would still be silent.
                if (video.volume === 0) video.volume = 1;
            } else {
                video.muted = true;
            }
        }

        /** Change the volume by a step, from what is heard now. */
        function louder(by) {
            const from = video.muted ? 0 : video.volume;
            const next = Math.max(0, Math.min(1, Math.round((from + by) * 100) / 100));
            video.volume = next;
            video.muted = next === 0;
        }

        if (mute) mute.addEventListener('click', toggleMute);
        if (volume) {
            volume.addEventListener('input', () => {
                const level = Math.max(0, Math.min(1, Number(volume.value) || 0));
                video.volume = level;
                if (level > 0) video.muted = false;
            });
        }
        video.addEventListener('volumechange', showSound);

        // ---- full screen ----------------------------------------------
        function toggleFull() {
            if (document.fullscreenElement === box) {
                if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
            } else if (box.requestFullscreen) {
                // Refused (a frame that does not allow it): nothing happens.
                box.requestFullscreen().catch(() => {});
            } else if (video.webkitEnterFullscreen) {
                // An iPhone only lets the video itself go full screen, with its own controls.
                video.webkitEnterFullscreen();
            }
        }

        function showFull() {
            const on = document.fullscreenElement === box;
            flag(box, 'data-fullscreen', on);
            if (full) full.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
        }

        if (full) full.addEventListener('click', toggleFull);
        document.addEventListener('fullscreenchange', showFull);

        // ---- the controls fade while it plays -------------------------
        let idleTimer = 0;

        /** The controls show, and fade again a while after the last move. */
        function awake() {
            clearTimeout(idleTimer);
            box.removeAttribute('data-idle');
            if (box.hasAttribute('data-playing')) stillLater();
        }

        function stillLater() {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                if (box.hasAttribute('data-playing')) box.setAttribute('data-idle', '');
            }, IDLE_AFTER);
        }

        box.addEventListener('pointermove', awake);
        box.addEventListener('focusin', awake);

        // ---- a file the browser cannot play ---------------------------
        // The message shows only when no file of the video can play. With
        // one file (a src on the video), the video's own error event says
        // so. With several (its <source>s, tried in order until one plays),
        // each one that cannot play fires the error at itself instead, and
        // once the last has, none is left: the video has no source. A file
        // that loaded but then fails fires it at the video too.
        const sources = Array.from(video.querySelectorAll('source'));
        const noneLeft = () => sources.length > 0 && video.networkState === NO_SOURCE && video.readyState === 0;

        function cannotPlay() {
            if (message) message.textContent = 'This browser cannot play this video';
        }

        video.addEventListener('error', cannotPlay);
        for (const source of sources) {
            source.addEventListener('error', () => {
                if (source === sources[sources.length - 1] || noneLeft()) cannotPlay();
            });
        }
        // Every file may have failed before this script ran. A video also
        // has no source for a moment while it starts choosing one, so that
        // is only believed when it lasts.
        if (video.error) cannotPlay();
        else if (noneLeft()) setTimeout(() => { if (noneLeft()) cannotPlay(); }, SETTLE);

        // ---- keys -----------------------------------------------------
        // Only while one of the player's controls has the focus, so the
        // keys never do anything anywhere else on the page.
        box.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const target = e.target;
            const onButton = target.localName === 'button';
            const onSlider = target.localName === 'input';
            const onSeek = target === seek;
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            // A button presses itself with Space, and a slider moves itself
            // with the arrows - except the time line, where an arrow moves
            // 5 seconds rather than a thousandth of the video.
            if (key === ' ' && (onButton || onSlider)) return;
            if (onSlider && !onSeek && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
            if (key === ' ' || key === 'k') toggle();
            else if (key === 'ArrowLeft' || (onSeek && key === 'ArrowDown')) goTo(video.currentTime - SKIP);
            else if (key === 'ArrowRight' || (onSeek && key === 'ArrowUp')) goTo(video.currentTime + SKIP);
            else if (key === 'ArrowUp') louder(VOLUME_STEP);
            else if (key === 'ArrowDown') louder(-VOLUME_STEP);
            else if (key === 'm') toggleMute();
            else if (key === 'f') toggleFull();
            else if (key === 'Home') goTo(0);
            else if (key === 'End') goTo(video.duration);
            else return;
            e.preventDefault();
            awake();
        });

        showPlaying();
        showTime();
        showSound();
        showFull();
    }

    function start() {
        // One already set up is left alone, so the script loaded twice does nothing twice.
        for (const box of document.querySelectorAll('.video-player:not([data-ready])')) setUp(box);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
