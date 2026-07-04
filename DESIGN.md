---
name: 2CY Agent
description: 作者的原稿桌——黑白漫画原稿材质的 Agent 界面体系：抖动墨线、方眼稿纸、朱红印章，与只属于「她」的一点冰青。
colors:
  paper: "oklch(100% 0 0)"
  ink: "oklch(22% 0.01 280)"
  ink-soft: "oklch(42% 0 0)"
  ink-faint: "oklch(50% 0 0)"
  pencil: "oklch(70% 0 0)"
  manuscript-blue: "oklch(87% 0.05 230)"
  vermilion: "oklch(52% 0.185 30)"
  vermilion-wash: "oklch(52% 0.185 30 / 0.06)"
  soul-cyan: "oklch(70% 0.12 210)"
  soul-cyan-deep: "oklch(45% 0.09 215)"
typography:
  display:
    fontFamily: "'Dela Gothic One', 'Noto Sans SC', sans-serif"
    fontSize: "clamp(2.5rem, 8vw, 5.25rem)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Zhi Mang Xing', 'Ma Shan Zheng', 'Noto Sans SC', sans-serif"
    fontSize: "clamp(1.75rem, 3.4vw, 2.25rem)"
    fontWeight: 400
    letterSpacing: "0.05em"
  title:
    fontFamily: "'Ma Shan Zheng', 'Noto Sans SC', serif"
    fontSize: "clamp(17px, 2vw, 20px)"
    fontWeight: 400
    letterSpacing: "0.04em"
  body:
    fontFamily: "'Noto Sans SC', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "'Noto Sans SC', system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 900
    letterSpacing: "0.02em"
  annotation:
    fontFamily: "'Ma Shan Zheng', 'Noto Sans SC', serif"
    fontSize: "15px"
    fontWeight: 400
    letterSpacing: "0.18em"
rounded:
  none: "0"
  seal: "6px"
  wobble-a: "255px 18px 230px 16px / 18px 240px 16px 255px"
  wobble-b: "20px 245px 18px 235px / 250px 16px 255px 18px"
  wobble-c: "240px 16px 255px 20px / 16px 250px 18px 240px"
  wobble-d: "18px 250px 20px 245px / 245px 18px 240px 16px"
  wobble-tag: "10px 140px 12px 130px / 130px 10px 140px 12px"
  bubble: "22px 26px 24px 28px / 26px 22px 28px 24px"
spacing:
  tag-pad: "6px 14px 7px"
  note-pad: "13px 16px 14px"
  panel-pad: "clamp(22px, 3.5vw, 36px)"
  panel-gap: "clamp(22px, 3vw, 34px)"
  tag-gap: "10px 12px"
components:
  koma-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.wobble-a}"
    padding: "{spacing.panel-pad}"
  speech-bubble:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.bubble}"
    padding: "10px 20px 12px"
  tag:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.wobble-tag}"
    padding: "{spacing.tag-pad}"
  seal:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.vermilion}"
    typography: "{typography.annotation}"
    rounded: "{rounded.seal}"
  flow-note:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-soft}"
    padding: "{spacing.note-pad}"
  narration-box:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "26px 24px 24px 30px"
---

# Design System: 2CY Agent

## 1. Overview

**Creative North Star: "作者的原稿桌"（The Mangaka's Desk）**

整个产品是一张正在创作中的漫画原稿：水色方眼稿纸铺底，墨线抖动、铅笔底稿没有擦净，页边留着作者的手写批注，重要之处盖着朱红印章。用户和「她」都坐在这张桌前——界面不是"软件"，是一页摊开的原稿。

体系有一条贯穿性的双层结构——**桌与作**：**桌面（UI 框架）是草稿材质**，分镜格、批注框、标签的线条全部经过湍流置换滤镜产生手抖起伏，附带铅笔底稿线与排线阴影，永远保持"未完成"的进行感；**作品（角色立绘与「她」相关的呈现）是成稿材质**，干净利落的墨线、大面积实墨黑块压住画面、克制的排线只用于腮红与阴影、大量留白——桌子是未完成的，她是完成的。这一反差就是产品"生产力为骨、人设为皮"的视觉表达。

本体系明确拒绝（引自 PRODUCT.md 反面参考）：SaaS 模板感（紫蓝渐变、卡片堆叠、Inter 字体）、赛博霓虹二次元（紫粉色、发光描边、机能风 UI）、低年龄向卡通风（圆润糖果色）、编辑部杂志风（display serif + 斜体 + 分栏线）。

**Key Characteristics:**
- 真白纸 + 实墨线，无阴影、无渐变、无大圆角
- 所有"手绘"线条走粗糙滤镜（feTurbulence + feDisplacementMap），双笔画（墨线 + 铅笔底稿线）
- 水色方眼稿纸与非感光蓝内框作为全局纸张材质
- 色彩仅两处：朱红盖章（强调），冰青点睛（专属于「她」）
- 手写体承载"人的痕迹"，黑体承载"印刷信息"
- 角色立绘：成稿墨线、实墨黑块、留白、点睛之色

## 2. Colors

黑白为体，两色点睛：一枚暖印章，一双冷眼睛。

### Primary
- **朱红印泥 Vermilion**（oklch(52% 0.185 30)，≈#C43A28）：印章、盖戳强调、回流箭头、Moat 级高亮。它是"作者盖章确认"的动作，不是装饰色。淡染变体 **vermilion-wash**（透明度 0.06）仅用于被盖章元素的底色。

### Secondary
- **点睛冰青 Soul Cyan**（oklch(70% 0.12 210)，≈#3FB5CC）：专属于「她」——角色的眼睛、在线/思考状态标记、她的消息气泡的角标。仅作图形标记，永不作文字色；需要文字时用深变体 **soul-cyan-deep**（oklch(45% 0.09 215)，≈#1F6B7C）。

### Neutral
- **纸白 Paper**（oklch(100% 0 0)，#FFFFFF）：全局底色与所有容器背景。必须是真白，不允许米色/奶油色偏移。
- **墨黑 Ink**（oklch(22% 0.01 280)，≈#26262B）：主文字与所有墨线。
- **淡墨 Ink Soft**（oklch(42% 0 0)，≈#5C5C5C）：次级文字（注释、说明），对白底 6.6:1。
- **枯墨 Ink Faint**（oklch(50% 0 0)，≈#717171）：待交互的静默边线（如页边注默认态）。
- **铅笔灰 Pencil**（oklch(70% 0 0)，≈#ABABAB）：铅笔底稿线、页边手写批注、分隔线。仅装饰性痕迹，不承载必读信息。
- **非感光蓝 Manuscript Blue**（oklch(87% 0.05 230)，≈#BFDCEA）：方眼格线与稿纸内框。

**盖章规则（The Seal Rule）。** 朱红是动作不是颜色：每屏出现 ≤5 处，永远以"印章/盖戳/批红"的形态出现（带边框、可旋转、压在元素上）。一旦朱红被用作普通按钮色或链接色，体系即告失败。

**点睛规则（The Soul-Cyan Rule）。** 冰青只属于「她」。界面框架、按钮、图表禁止使用冰青；它出现的地方必须指向角色本身（眼睛、状态、她的话）。两个点睛色职能互斥：朱红=作者的手，冰青=她的魂。

**非感光蓝规则（The Non-Photo Blue Rule）。** 稿纸蓝是纸张材质而非设计色——它必须始终淡到"扫描时会消失"的程度（透明度 ≤0.4 的格线），绝不参与信息层级。

## 3. Typography

**Display Font:** Dela Gothic One（拉丁标志/大标题，fallback Noto Sans SC）
**Headline Font:** Zhi Mang Xing 行书——**作者的字迹**（标题、批注、回目、日期）
**Title Font:** Ma Shan Zheng 楷体——**她的字迹**（台词、名字、口癖；兼作印章文字与竖排刊记）
**Body Font:** Noto Sans SC（正文与标签，system-ui fallback）

**Character:** 四种字各司其职，构成"一页原稿上会出现的四种字迹"：印刷的标志字、作者潦草的行书、她工整的楷体、照排的正文黑体。**两个人，两种笔迹**——作者写得快而草，她写得清而稳，同屏出现时读者不需要标签就知道谁在说话。

### Hierarchy
- **Display**（400，clamp(2.5rem, 8vw, 5.25rem)，行高 1.04）：产品标志与扉页大标题，仅拉丁与数字，Dela Gothic One。
- **Headline**（400，clamp(1.75rem, 3.4vw, 2.25rem)，字距 0.05em）：区块标题、层名、格数，行书手写。
- **Title**（400，clamp(17px, 2vw, 20px)）：对话气泡台词，楷体——她的手迹，工整可读。
- **Body**（400，14–15px，行高 1.7–1.75）：正文、注释、标签内容，思源黑体；行长 ≤42em。
- **Label**（900，12.5–14px）：路径标签、强调短语，思源黑体重磅；拉丁小注可用 Dela 11px（字距 0.08em）。

**谁在说话规则（The Who-Is-Speaking Rule）。** 手写体只承载"人的痕迹"，黑体只承载"印刷信息"（正文、数据、标签），禁止互换。手写体内部再分两只手：**行书是作者的字**（标题、批注、回目、日期），**楷体是她的字**（台词、名字、口癖）——台词必须用楷体保证长句可读，批注可以潦草因为只是痕迹。用黑体写台词是出戏，用手写体排正文是灾难，用行书写她的长台词是折磨读者。

## 4. Elevation

**纸上无影（The Paper Rule）。** 本体系完全平面：禁止 box-shadow 阴影、渐变与毛玻璃。深度由三种纸上手段表达：墨线粗细（2.5–3px 主线 / 1.5px 次线 / 1px 铅笔线）、双笔画层次（墨线外圈的铅笔底稿线，outline offset 4px）、排线阴影（48° 斜排线，透明度 0.16–0.34）。唯一的例外是联动命中态的"记号笔圈注"：`box-shadow: 0 0 0 3px paper, 0 0 0 5.5px vermilion`——这不是阴影，是作者用红笔把格子圈了出来。

## 5. Components

所有"手绘"组件的公共材质：边框走 SVG 粗糙滤镜（大元素 baseFrequency 0.032 / scale 3.6，小元素 0.06 / scale 2），主线墨黑，底稿线铅笔灰。

### 分镜格 Koma Panel（签名组件）
- **Shape:** 手绘抖动圆角（四套 wobble 半径轮换），交替微倾 ±0.2–0.3°，hover 时摆正并上浮 2px
- **Border:** 2.5px 墨线 + 4px 外偏移的 1px 铅笔底稿线，均过粗糙滤镜
- **排线角:** 一角覆盖 48° 排线纹理（透明度 0.16），radial mask 渐隐；奇偶格对角交替
- **命中态 (.is-hit):** 红笔圈注环 + 排线加深至 0.34 + 摆正

### 对话气泡 Speech Bubble
- **Style:** 2px 墨线、有机圆角、双三角描边尾巴，整体过粗糙滤镜
- **Typography:** 行书 Title 级——气泡里是「她」或该区块自己在说话
- **Rule:** 每个分镜格至多一个气泡；气泡内容必须是第一人称的"台词"，不是说明文

### 标签 Tag
- **Style:** 2px 墨线手绘小框（wobble-tag 半径），偶数项微旋 ±0.4–0.5°，内含黑体条目 + 淡墨小注
- **盖章态 (.is-sealed):** 边框转朱红、文字加粗，右上角压小号朱红印章

### 印章 Seal
- **Style:** 楷体、朱红 3px 边框 + 2px 外偏移 1px 描边（双环钤印感）、圆角 6px、旋转 -8° 至 +9°、白底
- **入场:** 盖章动画（scale 1.5→1，500ms ease-out）

### 页边注 Flow Note
- **Style:** 1.5px 枯墨细线框（过滤镜），hover/focus 左移 3px、边线转墨黑（回流类转朱红）
- **联动:** data-layers 声明关联分镜格，hover/focus 时为其加红笔圈注

### 旁白框 Narration Box
- **Style:** 3px 墨线直角矩形（与 wobble 分镜格形成"旁白 vs 画格"的对比），左上角压单字章（旋转 -8°）
- **Moat 变体:** 朱红边框 + vermilion-wash 底色

### 手写批注 Scribble
- **Style:** 行书、铅笔灰、16px、微旋、绝对定位于宿主元素旁；纯装饰（aria-hidden），移动端可隐藏
- **Rule:** 每屏 ≤2 处，内容必须是"作者会写的话"（盖章确认！/ 护城河在这里！！）

### 角色立绘 Character Artwork（成稿层）
- **线质:** 干净利落的成稿墨线，起笔收笔有锋，不过粗糙滤镜——她不是草稿
- **黑块:** 大面积实墨（头发、服饰细节）压住画面，与细线形成重量对比
- **阴影:** 仅用克制排线（腮红、暗部），禁止灰阶渐变与赛璐璐上色
- **留白:** 立绘悬浮于纸白之上，不加背景框
- **点睛:** 眼睛可用冰青（Soul-Cyan Rule 的本源），其余保持黑白

## 6. Do's and Don'ts

### Do:
- **Do** 所有手绘线条过粗糙滤镜——直而光滑的"手绘框"是体系里最刺眼的假货。
- **Do** 保持纸白为真白（#FFFFFF），任何暖色偏移都会毁掉墨线的对比。
- **Do** 朱红只以印章/盖戳/批红形态出现，每屏 ≤5 处；冰青只指向「她」。
- **Do** 正文对比度 ≥4.5:1（淡墨 #5C5C5C 起步），铅笔灰只做装饰痕迹。
- **Do** 动效克制且有纸感：盖章、圈注、显现，全部配 prefers-reduced-motion 降级。
- **Do** 立绘用成稿墨线 + 实墨黑块 + 留白（参照已确认的两张角色参考图的手法）。

### Don't:
- **Don't** 出现"SaaS 模板感"：紫蓝渐变、卡片堆叠、Inter 字体、hero-metric 布局（PRODUCT.md 反面参考，原文照录）。
- **Don't** 出现"赛博霓虹二次元"：紫粉色、发光描边、机能风 UI。
- **Don't** 出现"低年龄向卡通风"：圆润糖果色、大圆角 Q 版。
- **Don't** 滑向"编辑部杂志风"：display serif + 斜体 + 分栏线是另一条已饱和的赛道。
- **Don't** 使用 box-shadow 阴影、渐变文字、毛玻璃、彩色侧边条（border-left 色条）。
- **Don't** 给界面框架用冰青，给「她」以外的东西点睛——稀有性一旦稀释，点睛就死了。
- **Don't** 用手写体排正文或用黑体写台词——一眼假，等于让照排工帮作者代笔。
- **Don't** 让稿纸蓝参与信息层级——它扫描时应该消失。
- 一句话审计：**如果某个元素在真实漫画原稿上不可能出现，它就不属于这个界面。**
