export const creativeSuites = [
    { id: "launch", title: "商品上新", shots: ["hero", "scene", "detail", "feature", "closing"] },
    { id: "apparel", title: "服饰详情", shots: ["hero", "fit", "detail", "variant", "closing"] },
    { id: "marketplace", title: "跨境卖点", shots: ["hero", "feature", "scene", "detail", "closing"] },
];

const roles = {
    hero: ["商品主图", "突出商品整体", "以单个完整商品为主，使用简洁背景和真实接触阴影。保持参考图的视角和外形，主图中不添加促销文案或装饰贴纸。"],
    scene: ["使用场景", "表现商品如何使用", "把商品置于与真实用途相符的环境中。用自然接触阴影和合理尺度把商品融入空间，配景不得遮住识别特征。"],
    detail: ["材质细节", "展示可见材质和做工", "选择参考图中确实可见的纹理、接缝或工艺，用特写和侧光表现。保留原材质和颜色，禁止编造看不见的结构。"],
    feature: ["卖点说明", "让一项真实卖点读得懂", "从已知事实选择一个最适合画面表达的卖点，用清晰构图与留白说明。没有已知事实时只展示商品可见特征，留出后期排版区。"],
    fit: ["上身版型", "看清服装轮廓与垂感", "以自然站姿展示服装长度、版型、松量和垂感。保留实物的领口、袖型、印花和缝线，画面不臆造尺码或身高数据。"],
    variant: ["款式或配色", "表现已提供的款式差异", "只有在素材或已知事实中确有多个款式时才展示差异。只有一个款式时，保持同一款式并展示正面与侧面能看到的真实细节。"],
    closing: ["详情页收尾", "让商品与版式自然收束", "以稳定的主体构图和干净留白结束整套详情图。可为后期文案留位，不生成价格、折扣、库存、包邮或未经核实的承诺。"],
};

export function buildStoryboard({ suiteId, product, facts, market, language, artDirection }, template) {
    const suite = creativeSuites.find(item => item.id === suiteId) || creativeSuites[0];
    const productName = String(product || "").trim();
    if (!productName) return [];
    const lines = [
        `商品：${productName}`,
        facts?.trim() ? `只可依据这些已知事实：${facts.trim()}` : "只表现商品参考图可核实的特征。",
        market?.trim() ? `目标渠道与市场：${market.trim()}` : "",
        `文案语种：${language || "简体中文"}。仅在该分镜需要文案且事实已有依据时添加，保持短句清晰。`,
        `全套视觉：${artDirection?.trim() || template?.style || "干净的商业摄影，统一色温、光源方向和留白节奏。"}`,
        "以随本次请求提供的商品图为实物参考，保持商品的版型、比例、颜色、纹理、标识和包装文字。不得新增参考中不存在的配件、认证、数据或卖点。",
    ].filter(Boolean);
    if (template) return template.shots.map(shot => ({
        id: shot.id, title: shot.title, detail: "参考套图",
        prompt: [...lines, `本张画面：${shot.prompt}`, "只输出这一张分镜画面。"].join("\n"),
    }));
    return suite.shots.map(id => {
        const [title, detail, composition] = roles[id];
        return { id, title, detail, prompt: [...lines, `本张画面：${title}。 ${composition}`, "只输出这一张分镜画面。"].join("\n") };
    });
}
