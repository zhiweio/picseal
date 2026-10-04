# 媒体 CDN（Cloudflare R2）运维手册

演示媒体（样片 41MB / 放映室影音 17MB / 水印字体 15MB / GLB 3.8MB / BGM 2.1MB / logo 2MB）
托管在 Cloudflare R2，经 `media.zhiweio.me` 自定义域分发（Cloudflare 全球边缘缓存，零出口流量费）。
应用侧由 `src/core/media-url.ts` 的 `mediaUrl()` 统一改写：构建期注入 `NEXT_PUBLIC_MEDIA_BASE`
即走 CDN，不设置则用应用自身的 `public/`（Docker 镜像仍自带全部媒体作兜底）。

**隐私红线**：CDN 只承载随仓库分发的演示媒体；用户照片 / 作品集永远只在浏览器本地，
本方案不引入任何把用户数据发往网络的路径。

## 资源清单

| 资源 | 桶内前缀 | 缓存策略 |
| --- | --- | --- |
| 样片 JPG | `samples/` | immutable 1 年（CDN） |
| 样片清单 | `samples/manifest.json` | **由应用自身分发**（no-cache，CDN 强缓存层会重写头卡住更新） |
| 水印字体 | `fonts/` | immutable 1 年（CDN） |
| 品牌 logo | `brands/` | immutable 1 年（CDN） |
| 放映室影音 | `cinema/` | immutable 1 年（CDN） |
| 署名文档 | `cinema/CREDITS.md`、`audio/CREDITS.md` | **由应用自身分发**（no-cache） |
| 落地页 BGM | `audio/` | immutable 1 年（CDN） |
| 3D 模型 | `assets/` | immutable 1 年（CDN，GLB 带 `?v=` 哈希） |

`mediaUrl()` 对 manifest/CREDITS 一律不改写（`APP_SERVED` 白名单），桶内副本仅作灾备。
边缘缓存：zone 上有两条 Cache Rules——`manifest/CREDITS` 旁路；其余 media 主机
Eligible for cache（否则 `.glb`/`.m4a` 不在 Cloudflare 默认扩展名清单，进不了边缘缓存）。

桶：`picseal-media`（Account `1a2be850ec8c4b3d5ea917c9636b7d72`）。
CORS：`origins ["*"]`、`methods [GET, HEAD]`、`headers [range, content-type]`、`max_age_seconds 86400`
（公开资源用 `ACAO:*` 对 CDN 缓存键安全；Range 头是视频流式播放所必需）。

## 日常操作

```bash
pnpm sync:media            # dry-run：列出将上传的对象与元数据
pnpm sync:media --apply    # 实际上传（远端 ETag == 本地 MD5 自动跳过，可反复执行）
```

凭据从 `.env.r2` 读取（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `R2_BUCKET`），
走 Cloudflare REST 对象端点 + Bearer 认证（S3 端点需 SigV4，不适用本 token）。

## 变更工作流（重要）

媒体内容更新**必须换文件名**（既有规则）：样片/字体/logo 换名后重跑 `pnpm sync:media --apply`，
旧文件可留在桶里（不可变，浏览器与 CDN 都不会主动取）。GLB 已由 art/ 脚本带 `?v=` 哈希。
若确实需要让**同名文件**立即生效（如 logo 修版不想换名），需手动清缓存：
Dashboard → 域名 zhiweio.me → Caching → Purge（按 URL 清理对应对象），或用带
Zone Cache Purge 权限的 token 调 `POST /zones/{zone_id}/purge_cache`。

## 首次开通记录（2026-10）

1. 建桶：`POST /accounts/{id}/r2/buckets`（locationHint apac）
2. CORS：`wrangler r2 bucket cors set picseal-media --file <rules>`（注意 R2 用小写 `allowed` 嵌套格式，非 AWS 风格）
3. DNS：zone 建 `media` CNAME → `1a2be850ec8c4b3d5ea917c9636b7d72.r2.cloudflarestorage.com`，**开启橙云（proxied）**
   （R2 自定义域必须走 Cloudflare 代理才有边缘缓存与 TLS）
4. 挂自定义域（注意：**POST**、body 为驼峰字段 `zoneId`/`minTLS`，下划线字段会被静默忽略导致挂载空成功）：
   `POST /accounts/{id}/r2/buckets/picseal-media/domains/custom` + `{"domain":"media.zhiweio.me","enabled":true,"zoneId":"<zone id>"}`
   挂载后 `GET .../domains/custom` 应出现该域，`status.ssl` 从 initializing 变为 ready 即生效
5. 上传：`pnpm sync:media --apply`

## 验证要点

- `curl -I https://media.zhiweio.me/samples/manifest.json` → `cache-control: no-cache`
- `curl -I https://media.zhiweio.me/samples/<某样片>.jpg` → `cache-control: public, max-age=31536000, immutable`，二次请求 `cf-cache-status: HIT`
- `curl -H "Origin: https://zhiweio.me" -I ...` → `access-control-allow-origin: *`
- `curl -H "Range: bytes=0-1023" -I .../cinema/intro.mp4` → `206` + `content-range`
- 应用 Network 面板：媒体请求全部命中 `media.zhiweio.me`，worker 内字体/logo 加载无 CORS 报错

## 故障回退

- R2 / 自定义域异常：清空 Vercel 的 `NEXT_PUBLIC_MEDIA_BASE` 并 redeploy，即回到应用自身分发（镜像内含全部媒体）。
- cinema 素材缺失本身有三级兜底（用户导入 → 捆绑素材 HEAD 探测 → CC0 回退），CDN 不可用只会退化演示素材。
