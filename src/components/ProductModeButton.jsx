import React from "react";
import "./ProductModeButton.css";

export const PRODUCT_MODE_ORDER = Object.freeze([
    { id: "runninghub", label: "RunningHub", title: "RunningHub" },
    { id: "banana", label: "织影", title: "织影" },
    { id: "comfy", label: "Comfy UI", title: "Comfy UI" },
    { id: "prompt-library", label: "提示词库", title: "提示词库" },
    { id: "retouch", label: "精修工具", title: "精修工具" },
    { id: "settings", label: "设置", title: "设置" },
]);

export function nextProductMode(activeProduct) {
    const index = PRODUCT_MODE_ORDER.findIndex((item) => item.id === activeProduct);
    return PRODUCT_MODE_ORDER[((index < 0 ? 0 : index) + 1) % PRODUCT_MODE_ORDER.length].id;
}

export function ProductModeButton({ activeProduct, onChange }) {
    return (
        <nav className="wfa-product-mode-panel" aria-label="工作区">
            {PRODUCT_MODE_ORDER.map((item) => (
                <button
                    key={item.id}
                    type="button"
                    className={"wfa-product-mode-item" + (item.id === activeProduct ? " is-current" : "")}
                    onClick={() => item.id !== activeProduct && onChange?.(item.id)}
                    aria-current={item.id === activeProduct ? "page" : undefined}
                    title={item.title}
                >
                    {item.label}
                </button>
            ))}
        </nav>
    );
}
