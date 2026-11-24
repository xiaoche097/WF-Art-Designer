import React from "react";

export const DEFAULT_CLOTH_SETTINGS = { fine: 45, coarse: 55 };

export function ClothSliders({ settings, onChange, disabled }) {
    return <div className="wfa-cloth-sliders">
        {[["fine", "淡化细褶"], ["coarse", "淡化粗褶"]].map(([key, label]) => {
            const update = event => onChange(key, Number(event.currentTarget.value));
            return <label key={key} className="wfa-cloth-strength">
                <span>{label} <output>{settings[key]}%</output></span>
                <input aria-label={label} type="range" min="0" max="100" step="1" value={settings[key]}
                    disabled={disabled} onInput={update} onChange={update} />
            </label>;
        })}
    </div>;
}
