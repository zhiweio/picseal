# 测试夹具 / Test Fixtures

`writer.test.ts` 需要两张小体积 JPEG：

| 文件 | 说明 |
|---|---|
| `exif-sony.jpg` | 带完整 EXIF 的 Sony ILCE-7RM3 样片（长边 800px，EXIF 保留、Orientation 已归零） |
| `target.jpg` | 无 EXIF 的普通 JPEG（长边 800px），作为 EXIF 拷贝目标 |

由样片库重新生成：

```bash
node -e "
const { readFile, writeFile } = require('node:fs/promises')
const sharp = require('sharp')
;(async () => {
  const src = await readFile('public/samples/sony-ilce-7rm3-01.jpg')
  await writeFile('test/fixtures/exif-sony.jpg',
    await sharp(src).rotate().withMetadata()
      .resize({ width: 800 }).jpeg({ quality: 80 }).toBuffer())
  const other = await readFile('public/samples/' + require('node:fs').readdirSync('public/samples').find(f => f.endsWith('.jpg') && !f.startsWith('sony-ilce-7rm3')))
  await writeFile('test/fixtures/target.jpg',
    await sharp(other).rotate()
      .resize({ width: 800 }).jpeg({ quality: 80 }).toBuffer())
})()
"
```

夹具入库存档，日常开发无需重新生成。
