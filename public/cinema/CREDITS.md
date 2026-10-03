# 放映室媒体 / Projection Room Media

本目录下的 `intro.mp4`（开场片段）与 `welcome-home.m4a`（配乐）**来自网络，仅用于产品演示，版权归原作者所有**。如有侵权请联系（提 issue 即可），确认后立即删除。

`intro.mp4` (opening clip) and `welcome-home.m4a` (soundtrack) in this directory are **sourced from the web for demo purposes only; all rights remain with their original owners**. If anything here infringes your rights, open an issue and it will be removed promptly.

## 版权归属 / Copyright

- 开场片段：*The Secret Life of Walter Mitty*（2013）© 20th Century Fox，影迷剪辑
- 配乐：*Welcome Home* — Radical Face © Bear Tree Records

## 自备素材替换（可选 / Optional）

想用自己的素材时，转成同样规格放回本目录即可：

```bash
# 开场：1920×1080 H.264 + AAC，faststart
ffmpeg -i "<你的素材>.mp4" -c:v libx264 -crf 22 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart public/cinema/intro.mp4

# 配乐：AAC 192k，-vn 丢弃内嵌封面
ffmpeg -i "<你的音频>.flac" -vn -c:a aac -b:a 192k public/cinema/welcome-home.m4a
```

也可以在放映室内「载入本地素材」直接导入，仅存于浏览器 IndexedDB。

## 无素材时的回退

未检测到上述文件时，放映室自动降级：跳过开场片段直接进入片头卡，配乐回退到 `public/audio/bgm.mp3`（Komiku，CC0）。
