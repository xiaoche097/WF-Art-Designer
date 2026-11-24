import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ProductSwitcherMenu.css";

const MENU_CLOSE_MS = 140;
const MENU_LAYER_Z = 100020;

const IconGridDots = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="4" y="4" width="5.5" height="5.5" rx="1.2" />
        <rect x="14.5" y="4" width="5.5" height="5.5" rx="1.2" />
        <rect x="4" y="14.5" width="5.5" height="5.5" rx="1.2" />
        <rect x="14.5" y="14.5" width="5.5" height="5.5" rx="1.2" />
    </svg>
);

export const WfBrandIcon = ({ className = "" } = {}) => (
    <img className={`wfa-product-rh-glyph ${className}`.trim()} src="icons/wf-brand.png" alt="" />
);

const IconReload = () => (
    <svg className="wfa-product-rh-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20.5 6.5v5h-5" />
        <path d="M3.5 17.5v-5h5" />
        <path d="M5.4 10.1A7.8 7.8 0 0 1 18.9 7l1.6 4.5" />
        <path d="M18.6 13.9A7.8 7.8 0 0 1 5.1 17l-1.6-4.5" />
    </svg>
);

function useHoverMenu(onOpenChange) {
    const [open, setOpen] = useState(false);
    const closeTimerRef = useRef(null);

    const cancelClose = useCallback(() => {
        if (!closeTimerRef.current) return;
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    const commitOpen = useCallback(
        (next) => {
            setOpen(next);
            onOpenChange?.(next);
        },
        [onOpenChange]
    );

    const openNow = useCallback(() => {
        cancelClose();
        commitOpen(true);
    }, [cancelClose, commitOpen]);

    const closeSoon = useCallback(() => {
        cancelClose();
        closeTimerRef.current = setTimeout(() => commitOpen(false), MENU_CLOSE_MS);
    }, [cancelClose, commitOpen]);

    const closeNow = useCallback(() => {
        cancelClose();
        commitOpen(false);
    }, [cancelClose, commitOpen]);

    useEffect(() => () => cancelClose(), [cancelClose]);

    return { open, openNow, closeSoon, closeNow };
}

function useMenuAnchor(open, triggerRef) {
    const [anchor, setAnchor] = useState({ top: 0, left: 0 });

    const measure = useCallback(() => {
        const node = triggerRef.current;
        if (!node) return;
        const box = node.getBoundingClientRect();
        setAnchor({ top: Math.round(box.bottom + 4), left: Math.round(box.left) });
    }, [triggerRef]);

    useLayoutEffect(() => {
        if (!open) return undefined;
        measure();
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [open, measure]);

    return anchor;
}

function ProductMenuPortal({ open, triggerRef, onEnter, onLeave, children }) {
    const anchor = useMenuAnchor(open, triggerRef);
    if (!open || typeof document === "undefined") return null;
    return createPortal(
        <div
            className="wfa-product-menu-popover"
            style={{ position: "fixed", top: anchor.top, left: anchor.left, zIndex: MENU_LAYER_Z }}
            role="menu"
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
        >
            {children}
        </div>,
        document.body
    );
}

function ProductMenuItem({ current, label, icon, onClick, extraClass = "" }) {
    return (
        <button
            type="button"
            role="menuitem"
            className={`wfa-product-menu-item${current ? " is-current" : ""}${extraClass ? ` ${extraClass}` : ""}`}
            onClick={onClick}
        >
            <span className="wfa-product-menu-mark" aria-hidden>{icon}</span>
            <span className="wfa-product-menu-label">{label}</span>
        </button>
    );
}

export function ProductSwitcherMenu({
    onOpenLauncher,
    onSelectRunningHub,
    onReload,
    activeProductId,
    onOpenChange,
    triggerTitle,
    isActiveProduct = true,
}) {
    const triggerRef = useRef(null);
    const { open, openNow, closeSoon, closeNow } = useHoverMenu(onOpenChange);

    useEffect(() => {
        if (isActiveProduct) return;
        closeNow();
    }, [isActiveProduct, closeNow]);

    const runAndHide = useCallback(
        (action) => {
            closeNow();
            action?.();
        },
        [closeNow]
    );

    const rows = useMemo(
        () => [
            {
                id: "runninghub",
                label: "RunningHub",
                icon: <WfBrandIcon />,
                action: onSelectRunningHub,
            },
            {
                id: "reload",
                label: "刷新插件",
                icon: <IconReload />,
                action: onReload,
                extraClass: "wfa-product-menu-item--reload",
            },
        ],
        [onSelectRunningHub, onReload]
    );

    return (
        <div className={`wfa-product-menu${open ? " is-open" : ""}`} onMouseEnter={openNow} onMouseLeave={closeSoon}>
            <button
                ref={triggerRef}
                type="button"
                className="icon-btn wfa-product-menu-trigger"
                onClick={() => onOpenLauncher?.()}
                title={triggerTitle || "工作台选择"}
                aria-expanded={open}
                aria-haspopup="menu"
            >
                <IconGridDots />
            </button>
            <ProductMenuPortal open={open} triggerRef={triggerRef} onEnter={openNow} onLeave={closeSoon}>
                {rows.map((row) => (
                    <ProductMenuItem
                        key={row.id}
                        current={activeProductId === row.id}
                        label={row.label}
                        icon={row.icon}
                        extraClass={row.extraClass}
                        onClick={() => runAndHide(row.action)}
                    />
                ))}
            </ProductMenuPortal>
        </div>
    );
}
