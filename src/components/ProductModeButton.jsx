import React from "react";
import "./ProductModeButton.css";

export const PRODUCT_MODE_ORDER = Object.freeze([
    { id: "runninghub", label: "runninghub", title: "RunningHub" },
    { id: "banana", label: "织影", title: "织影" },
    { id: "comfy", label: "comfy ui", title: "Comfy UI" },
    { id: "retouch", label: "精修工具", title: "精修工具" },
    { id: "settings", label: "设置", title: "设置" },
]);

export function nextProductMode(activeProduct) {
    const index = PRODUCT_MODE_ORDER.findIndex((item) => item.id === activeProduct);
    return PRODUCT_MODE_ORDER[((index < 0 ? 0 : index) + 1) % PRODUCT_MODE_ORDER.length].id;
}

export function ProductModeButton({ activeProduct, onChange }) {
    return (
        <div className="wfa-product-mode-panel" role="navigation" aria-label="板块切换">
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
        </div>
    );
}
