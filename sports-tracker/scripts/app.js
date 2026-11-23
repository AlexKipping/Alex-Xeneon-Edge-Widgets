'use strict';

// Shell: sport switcher, enable/disable per sport and automatic switching after inactivity.
const Shell = (function () {
    const switcher = document.getElementById('sport-tabs');
    const slot = document.getElementById('sport-slot');
    let active = null;            // currently shown sport
    let enabledList = [];
    let started = false;
    let idleTimer = null;
    let lastStartSport = null;
    const initialised = new Set();

    const byId = id => Sports.list.find(s => s.id === id);
    const section = s => document.getElementById('sport-' + s.id);

    function computeEnabled() {
        let list = Sports.list.filter(s => prop(s.enabledProp, true) !== false);
        if (!list.length) list = Sports.list.slice(0, 1);   // never leave the widget empty
        return list;
    }

    function show(s) {
        if (active === s) return;
        if (active) {
            const old = section(active);
            old.classList.remove('active');
            old.insertBefore(active.controls, old.firstChild);   // park the controls back in their section
        }
        active = s;
        section(s).classList.add('active');
        slot.replaceChildren(s.controls);
        applyAccent();
        renderSwitcher();
        if (s.onShow) s.onShow();
    }

    function applyAccent() {
        if (!active) return;
        const accent = String(prop(active.accentProp, active.defaultAccent));
        const root = document.documentElement.style;
        root.setProperty('--accent', accent);
        root.setProperty('--accent-dim', /^#[0-9a-f]{6}$/i.test(accent) ? accent + '26' : accent);
    }

    function renderSwitcher() {
        switcher.hidden = enabledList.length < 2;
        switcher.innerHTML = enabledList.map(s =>
            '<button class="sport-tab' + (s === active ? ' active' : '') + '" data-sport="' + esc(s.id) + '">' + esc(s.label) + '</button>'
        ).join('');
    }

    switcher.addEventListener('click', e => {
        const b = e.target.closest('.sport-tab');
        if (!b) return;
        const s = byId(b.dataset.sport);
        if (s) show(s);
    });

    // Any touch, click, scroll or key press counts as activity and restarts the countdown.
    function restartIdle() {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (prop('autoSwitch', true) === false || enabledList.length < 2) return;
        const secs = Math.max(5, Number(prop('idleSeconds', 30)) || 30);
        idleTimer = setTimeout(() => {
            const i = enabledList.indexOf(active);
            show(enabledList[(i + 1) % enabledList.length]);
            restartIdle();
        }, secs * 1000);
    }
    ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(ev =>
        document.addEventListener(ev, restartIdle, { capture: true, passive: true }));

    function applyProps() {
        const root = document.documentElement.style;
        const text = prop('textColor', '#FFFFFF');
        root.setProperty('--text-main', text);
        root.setProperty('--text', text);

        enabledList = computeEnabled();
        enabledList.forEach(s => {
            if (!initialised.has(s.id)) { initialised.add(s.id); s.start(); }
        });
        enabledList.forEach(s => s.applyProps());

        const ss = prop('startSport', Sports.list[0].id);
        if (ss !== lastStartSport) {
            lastStartSport = ss;
            const s = byId(ss);
            if (s && enabledList.includes(s)) show(s);
        }
        if (!active || !enabledList.includes(active)) show(enabledList[0]);
        applyAccent();
        renderSwitcher();
        restartIdle();
    }

    function start() {
        if (started) return;
        started = true;
        applyProps();
    }

    return { start, applyProps };
})();
