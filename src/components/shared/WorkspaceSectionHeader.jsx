import React from "react";

export function WorkspaceSectionHeader({ title, open, onToggle, children }) {
    return (
        <div className="card-header wfa-section-header">
            <button type="button" className="wfa-section-toggle" aria-expanded={open} onClick={onToggle}>
                <span className="header-title">{title}</span>
                <span className={`collapse-arrow ${open ? "expanded" : "collapsed"}`} aria-hidden="true">
                    <span className="arrow-icon" />
                </span>
            </button>
            {children}
        </div>
    );
}
