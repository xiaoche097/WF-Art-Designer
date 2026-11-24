const BODY_CLASS = "wfa-dropdown-focus-active";
const SELECTORS = [
    ".wfa-param-select-menu--open",
    ".wfa-param-select-menu--closing",
    ".rh-app-select-dropdown.open",
    ".rh-app-select-dropdown.closing",
    ".rh-work-app-dropdown.open",
    ".rh-work-app-dropdown.opening",
    ".rh-work-app-dropdown.closing",
    ".forge-param-select-menu-portal",
    ".banana-param-dropdown.is-open",
    ".banana-param-menu--portal",
    ".banana-prompt-preset-menu-portal",
    ".wfa-product-menu.is-open",
    ".wfa-product-menu-popover",
    ".reverse-dropdown.open",
    ".wfa-ledger-export-menu.open",
    ".wfa-ledger-export-menu-portal",
    ".xres-folder-menu",
    ".xres-feather-menu",
    ".xres-delete-menu",
    ".xlup-ref-column-menu",
    ".preset-context-menu",
    ".context-menu",
    ".channel-select-wrap.open",
    ".channel-select-dropdown",
    "select:focus",
];

let installed = false;
let observer = null;
let raf = 0;

function hasOpenDropdown() {
    if (typeof document === "undefined") return false;
    return SELECTORS.some((selector) => {
        try {
            return !!document.querySelector(selector);
        } catch (_) {
            return false;
        }
    });
}

function refresh() {
    raf = 0;
    if (typeof document === "undefined") return;
    document.body?.classList.toggle(BODY_CLASS, hasOpenDropdown());
}

function scheduleRefresh() {
    if (typeof window === "undefined") return refresh();
    if (raf) return;
    raf = window.requestAnimationFrame(refresh);
}

export function installDropdownFocusEffect() {
    if (installed || typeof document === "undefined") return;
    installed = true;
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body || document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["class", "style"],
    });
    document.addEventListener("focusin", scheduleRefresh, true);
    document.addEventListener("focusout", scheduleRefresh, true);
    document.addEventListener("pointerdown", scheduleRefresh, true);
    document.addEventListener("click", scheduleRefresh, true);
    window.addEventListener("blur", scheduleRefresh);
    scheduleRefresh();
}

export function uninstallDropdownFocusEffect() {
    if (!installed || typeof document === "undefined") return;
    installed = false;
    observer?.disconnect();
    observer = null;
    if (raf && typeof window !== "undefined") window.cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener("focusin", scheduleRefresh, true);
    document.removeEventListener("focusout", scheduleRefresh, true);
    document.removeEventListener("pointerdown", scheduleRefresh, true);
    document.removeEventListener("click", scheduleRefresh, true);
    window.removeEventListener("blur", scheduleRefresh);
    document.body?.classList.remove(BODY_CLASS);
}
