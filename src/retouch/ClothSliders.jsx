import React from "react";

export const DEFAULT_CLOTH_SETTINGS = { upper: 100, lower: 100, fine: 45, coarse: 55 };

export function getClothParts(mask, regions) {
    const parts = { upper: false, lower: false, dress: false };
    if (!mask) return parts;
    for (let index = 0; index < mask.length; index++) {
        if (!mask[index]) continue;
        if (regions?.[index] === 2) parts.lower = true;
        else if (regions?.[index] === 3) parts.dress = true;
        else parts.upper = true;
    }
    return parts;
}

export function ClothSliders({ settings, onChange, disabled, parts }) {
    return <div className="wfa-cloth-sliders">
        {[
            ["upper", parts.dress && !parts.upper ? "连衣裙" : "上装", parts.upper || parts.dress],
            ["lower", "下装", parts.lower],
            ["fine", "淡化细褶", true], ["coarse", "淡化粗褶", true],
        ].map(([key, label, available]) => {
            const update = event => onChange(key, Number(event.currentTarget.value));
            return <label key={key} className="wfa-cloth-strength">
                <span>{label} <output>{available ? `${settings[key]}%` : "未识别"}</output></span>
                <input aria-label={label} type="range" min="0" max="100" step="1" value={settings[key]}
                    disabled={disabled || !available} onInput={update} onChange={update} />
            </label>;
        })}
    </div>;
}
