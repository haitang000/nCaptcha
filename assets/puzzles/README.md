# 图片回正题库

当前共有 **10 张** PNG。Node 从本目录加载；Workers 在构建时将同一题库打包为私有数据。

## 筛选标准

- 正常直立、相机水平，屋顶、头部、脚部、车轮或底座等上下线索清楚。
- 在 200px 圆形视口中，经过轻微随机裁剪和旋转，主要方向线索仍可辨认。
- 避免只有云层、水面、纹理、俯视物体、镜面倒影或多方向对称图案的画面。
- 新增图片统一保存为 256×256、不透明的 PNG，与后端题图尺寸一致；原图不额外改写。

## 保留与移除

| 文件 | 处理 | 原因 |
| --- | --- | --- |
| `puzzle-1.png` | 保留 | 树木、房屋和地面提供直立线索 |
| `puzzle-3.png` | 保留 | 楼房屋顶、门窗和崖壁有明确方向 |
| `puzzle-2.png` | 移除 | 麦田小路图的大面积天空，圆形裁切后直立参照较弱 |
| `puzzle-4.png` | 移除 | 云海以柔软纹理为主，缺少明确直立物体 |

原图来自本项目提取时的 localhosting 题库；保留文件内容未改动。

## 新增图片与生成提示词

以下 8 张图片于 2026-10-31 使用内置 **imagegen** 工具分别生成，没有使用 CLI 或外部图库。所有图均为生成内容；这里不新增原项目的开源许可声明。

每张图片的完整提示词由以下通用提示词和该图片的场景提示词拼接而成。

通用提示词：

> Use case: photorealistic-natural. Asset type: a square upright photo for a rotate-to-upright CAPTCHA. Create ONE photograph only, not a collage. Natural daylight, realistic textures, crisp recognizable silhouette, balanced contrast. Camera perfectly level, no tilt, no overhead view. Compose the entire main subject at center with all its identifying top and bottom details comfortably within the central 70% of the square, leaving safe margin for a circular crop and light random zoom. It must be immediately obvious which way is up at a tiny 200-pixel size, including after the corners are hidden. Opaque fully filled photographic background. No text, letters, numbers, logo, watermark, border or arrows.

### `puzzle-lighthouse.png` — 灯塔

> A white coastal lighthouse with a red lantern roof, a small attached keeper's cottage, standing upright on a rocky grassy headland; visible vertical tower, distinct roof at top and broad rock base below. Blue daytime sky above.

### `puzzle-windmill.png` — 风车

> A traditional Dutch brick windmill with four wooden sails, a dark pointed cap, and a clearly grounded broad brick base on a green meadow. The entire upright tower and cap are prominent. A few distant trees and a pale blue sky.

### `puzzle-cottage.png` — 小屋

> A small cream cottage with a steep red tiled roof and chimney, central front door, two windows and a green lawn below. Eye-level frontal view, roof clearly above the door, ground clearly below the foundation, blue daytime sky.

### `puzzle-bus.png` — 巴士

> A vintage mustard-yellow small passenger bus in three-quarter side view parked on a quiet paved road, clearly visible dark wheels at its bottom and roof above the windows, distant leafy trees and blue sky. No writing or logos on the bus.

### `puzzle-penguin.png` — 企鹅

> One adult king penguin standing fully upright on a grey rocky shore, feet planted visibly below its plump body and its head and orange-yellow neck marking clearly above, in a natural three-quarter side view. The head is held vertically upright rather than tilted. A softly blurred seashore background.

### `puzzle-dog.png` — 金毛犬

> One golden retriever sitting naturally upright on a green garden lawn, full body visible, head straight above torso with visible ears and eyes, front paws firmly on the grass below. Three-quarter front view at the dog's eye level, softly blurred shrubs and garden behind it.

### `puzzle-chair.png` — 椅子

> A single red-painted wooden garden chair, three-quarter front view, standing firmly on a grey stone patio, full tall upright backrest above its seat and all four legs visible below the seat. A softly blurred green hedge behind it. The chair is perfectly level, not leaning.

### `puzzle-sunflower.png` — 向日葵盆栽

> A terracotta flower pot standing on a pale wooden garden table, holding a single robust upright sunflower stalk with broad leaves and one recognizable yellow sunflower head near the top, its stem vertical. The flower pot, entire stalk, and flower head all visible in the center. Soft green garden background, no sky-only expanse. Eye-level three-quarter view, not overhead.
