import React from "react";

export function WorkspaceHeader({ title, detail, actions, className = "" }) {
    return (
        <header className={`rh-balance-bar wfa-workspace-header ${className}`}>
            <div className="rh-balance-content">
                <img src="icons/wf-brand.png" className="rh-balance-icon" alt="" />
                <div className="wfa-workspace-heading">
                    <h2>{title}</h2>
                    {detail && <div className="wfa-workspace-detail">{detail}</div>}
                </div>
            </div>
            {actions && <div className="rh-balance-bar-right">{actions}</div>}
        </header>
    );
}
