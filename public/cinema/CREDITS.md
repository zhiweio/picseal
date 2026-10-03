# 放映室媒体 / Projection Room Media

放映室的开场片段与配乐为**商业版权作品，不随开源仓库分发**（本目录下的 `intro.mp4`、`welcome-home.m4a` 已被 `.gitignore` 排除，仅存在于你自己的机器上）。

## 获取完整体验（本地一次配置）

将自己拥有的素材放入本目录（或放映室内「载入本地素材」导入，存于浏览器 IndexedDB）：

```bash
# 开场：白日梦想家片段（1920×1080 H.264 + AAC，faststart）
ffmpeg -i "<你的素材>.mp4" -c:v libx264 -crf 22 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart public/cinema/intro.mp4

# 配乐：Radical Face — Welcome Home（FLAC → AAC 192k，-vn 丢弃内嵌封面）
ffmpeg -i "Radical Face - Welcome Home.flac" -vn -c:a aac -b:a 192k public/cinema/welcome-home.m4a
```

## 版权归属

- 开场片段：*The Secret Life of Walter Mitty*（2013）© 20th Century Fox，影迷剪辑
- 配乐：*Welcome Home* — Radical Face © Bear Tree Records

## 无素材时的回退

未检测到上述文件时，放映室自动降级：跳过开场片段直接进入片头卡，配乐回退到 `public/audio/bgm.mp3`（Komiku，CC0）。
