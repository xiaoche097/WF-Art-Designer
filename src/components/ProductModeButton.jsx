import React, { useEffect, useRef, useState } from "react";
import "./ProductModeButton.css";

export const PRODUCT_MODE_ORDER = Object.freeze([
    { id: "runninghub", label: "RunningHub", title: "RunningHub" },
    { id: "banana", label: "织影", title: "织影" },
    { id: "ps-tools", label: "PS 工具", title: "PS 工具" },
    { id: "comfy", label: "Comfy UI", title: "Comfy UI" },
    { id: "prompt-library", label: "提示词库", title: "提示词库" },
    { id: "retouch", label: "精修工具", title: "精修工具" },
    { id: "settings", label: "设置", title: "设置" },
]);

const modes = Object.fromEntries(PRODUCT_MODE_ORDER.map(item => [item.id, item]));
const navigation = [
    { id: "workflows", label: "工作流", children: [modes.runninghub, modes.comfy] },
    modes.banana,
    { id: "tools", label: "工具库", children: [modes["ps-tools"], modes["prompt-library"]] },
    modes.retouch,
    modes.settings,
];

export function nextProductMode(activeProduct) {
    const index = PRODUCT_MODE_ORDER.findIndex((item) => item.id === activeProduct);
    return PRODUCT_MODE_ORDER[((index < 0 ? 0 : index) + 1) % PRODUCT_MODE_ORDER.length].id;
}

export function ProductModeButton({ activeProduct, onChange }) {
    const [openGroup, setOpenGroup] = useState(null);
    const navRef = useRef(null);
    const groupTrigger = useRef(null);

    useEffect(() => {
        if (!openGroup) return undefined;
        const closeOutside = event => {
            if (!navRef.current?.contains(event.target)) setOpenGroup(null);
        };
        document.addEventListener("pointerdown", closeOutside);
        return () => document.removeEventListener("pointerdown", closeOutside);
    }, [openGroup]);

    function select(id, restoreFocus = false) {
        setOpenGroup(null);
        if (restoreFocus) groupTrigger.current?.focus();
        if (id !== activeProduct) onChange?.(id);
    }

    return (
        <nav ref={navRef} className="wfa-product-mode-panel" aria-label="工作区"
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpenGroup(null);
            }}
            onKeyDown={event => {
                if (event.key !== "Escape" || !openGroup) return;
                event.stopPropagation();
                setOpenGroup(null);
                groupTrigger.current?.focus();
            }}>
            {navigation.map(item => {
                if (!item.children) return (
                    <button
                        key={item.id}
                        type="button"
                        className={"wfa-product-mode-item" + (item.id === activeProduct ? " is-current" : "")}
                        onClick={() => select(item.id)}
                        aria-current={item.id === activeProduct ? "page" : undefined}
                        title={item.title}
                    >
                        {item.label}
                    </button>
                );
                const open = openGroup === item.id;
                const current = item.children.find(child => child.id === activeProduct);
                const listId = "wfa-nav-" + item.id;
                return <div key={item.id} className="wfa-product-group">
                    <button type="button" className={"wfa-product-mode-item wfa-product-group-trigger" + (current ? " is-current" : "")}
                        title={current ? `${item.label} · ${current.title}` : item.label}
                        aria-label={current ? `${item.label}，当前 ${current.title}` : item.label}
                        aria-expanded={open} aria-controls={listId}
                        onClick={event => {
                            groupTrigger.current = event.currentTarget;
                            setOpenGroup(open ? null : item.id);
                        }}>
                        {item.label}<span className="wfa-product-group-caret" aria-hidden="true" />
                    </button>
                    <ul id={listId} className="wfa-product-group-list" aria-label={item.label} hidden={!open}>
                        {item.children.map(child => <li key={child.id}>
                            <button type="button" title={child.title} aria-current={child.id === activeProduct ? "page" : undefined}
                                onClick={() => select(child.id, true)}>
                                <span>{child.label}</span>
                                {child.id === activeProduct && <span aria-hidden="true">✓</span>}
                            </button>
                        </li>)}
                    </ul>
                </div>;
            })}
        </nav>
    );
}
