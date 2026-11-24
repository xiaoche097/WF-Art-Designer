import React, { useMemo } from "react";
import { versions } from "uxp";
import os from "os";
import { PLUGIN_CHINESE_NAME } from "../pluginMeta.js";
import { WfBrandIcon } from "./ProductSwitcherMenu.jsx";
import "./About.css";

function runtimeItems() {
    return [
        { label: "插件", value: `v${versions.plugin || "-"}` },
        { label: "系统", value: `${os.platform()} ${os.release()}` },
        { label: "UXP", value: versions.uxp || "-" },
    ];
}

const CAPABILITY_ROWS = Object.freeze([
    { title: "RunningHub 应用", text: "读取应用参数、管理预设集合、并行提交任务。" },
    { title: "回图工作台", text: "保存返图、记录任务上下文，并按设置贴回 PS。" },
    { title: "本地增强", text: "小黄鸭解码、缓存目录、上传质量与交互设置都在本地闭环。" },
]);

export const About = ({ dialog }) => {
    const runtime = useMemo(runtimeItems, []);

    const close = () => {
        if (dialog && typeof dialog.close === "function") dialog.close("ok");
    };

    return (
        <form method="dialog" className="wfa-about">
            <div className="wfa-about__body">
                <header className="wfa-about__masthead">
                    <div className="wfa-about__mark" aria-hidden="true">
                        <WfBrandIcon className="wfa-about__mark-icon" />
                    </div>
                    <div className="wfa-about__titlebox">
                        <div className="wfa-about__eyebrow">Photoshop AI 修图面板</div>
                        <h1 className="wfa-about__title">{PLUGIN_CHINESE_NAME}</h1>
                        <div className="wfa-about__version">V{versions.plugin || "-"}</div>
                    </div>
                </header>

                <section className="wfa-about__section" aria-label="核心能力">
                    {CAPABILITY_ROWS.map((item) => (
                        <div className="wfa-about__line" key={item.title}>
                            <div className="wfa-about__line-dot" aria-hidden="true" />
                            <div className="wfa-about__line-main">
                                <div className="wfa-about__line-title">{item.title}</div>
                                <div className="wfa-about__line-text">{item.text}</div>
                            </div>
                        </div>
                    ))}
                </section>

                <section className="wfa-about__runtime" aria-label="运行环境">
                    {runtime.map((item) => (
                        <div className="wfa-about__runtime-item" key={item.label}>
                            <span className="wfa-about__runtime-label">{item.label}</span>
                            <span className="wfa-about__runtime-value">{item.value}</span>
                        </div>
                    ))}
                </section>
            </div>

            <footer className="wfa-about__footer">
                <div className="wfa-about__copyright">© 2026 {PLUGIN_CHINESE_NAME}</div>
                <sp-button variant="primary" onClick={close}>确定</sp-button>
            </footer>
        </form>
    );
};
