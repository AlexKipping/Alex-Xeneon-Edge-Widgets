'use strict';

// Reads an iCUE control value (global variable injected by iCUE), with a fallback for browser previews.
function prop(name, fallback) {
    try {
        if (Object.prototype.hasOwnProperty.call(window, name)) {
            const v = window[name];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        const v2 = Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
        if (v2 !== undefined && v2 !== null && v2 !== '') return v2;
    } catch (e) { /* ignore */ }
    return fallback;
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Sport registry. Each sports/<id>.js file calls Sports.register() with:
//   id            unique id; index.html holds a <section id="sport-<id>">
//   label         name shown in the sport switcher
//   enabledProp   iCUE switch that turns the sport on or off
//   accentProp / defaultAccent   iCUE colour property and its default
//   controls      element with the sport's own tabs/buttons (moved into the shared header while the sport is shown)
//   start()       called once, the first time the sport is enabled (begin fetching data, timers)
//   applyProps()  called whenever iCUE settings change
//   onShow()      called each time the sport becomes visible (re-measure layouts)
// Registration order is the order of the switcher and of the automatic rotation.
const Sports = {
    list: [],
    register(sport) { this.list.push(sport); }
};
