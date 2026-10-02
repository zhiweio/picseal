//! PICSEAL EXIF writer —— little_exif 的 wasm 薄封装。
//!
//! 职责单一：把源照片的 EXIF 完整拷贝进目标（编码产物）文件。
//! 全格式覆盖：JPEG / PNG(eXIf) / WebP / TIFF / HEIF / JXL。

use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::ifd::ExifTagGroup;
use little_exif::metadata::Metadata;
use wasm_bindgen::prelude::*;

fn parse_file_type(kind: &str) -> Result<FileExtension, JsValue> {
    match kind.to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => Ok(FileExtension::JPEG),
        "png" => Ok(FileExtension::PNG {
            as_zTXt_chunk: false,
        }),
        "webp" => Ok(FileExtension::WEBP),
        "heif" | "heic" | "avif" | "hif" => Ok(FileExtension::HEIF),
        "tiff" | "tif" => Ok(FileExtension::TIFF),
        "jxl" => Ok(FileExtension::JXL),
        other => Err(JsValue::from_str(&format!("unsupported file type: {other}"))),
    }
}

fn js_err<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// 从源文件读取 EXIF，写入目标文件字节，返回带元数据的新字节串。
/// 跨格式复制：例如 HEIC 原图 → JPEG 输出。
///
/// 拷贝时重置 Orientation：画布渲染前像素已按 EXIF 方向摆正，
/// 若保留原 Orientation 标志，查看器会对输出图二次旋转。
#[wasm_bindgen]
pub fn copy_exif(
    source: &[u8],
    source_type: &str,
    target: &[u8],
    target_type: &str,
) -> Result<Vec<u8>, JsValue> {
    let src_ft = parse_file_type(source_type)?;
    let tgt_ft = parse_file_type(target_type)?;

    let mut metadata = Metadata::new_from_vec(&source.to_vec(), src_ft).map_err(js_err)?;
    metadata.remove_tag_by_hex_group(0x0112, ExifTagGroup::GENERIC);
    metadata.set_tag(ExifTag::Orientation(vec![1u16]));

    let mut out = target.to_vec();
    metadata.write_to_vec(&mut out, tgt_ft).map_err(js_err)?;
    Ok(out)
}

/// 嗅探文件类型："jpeg" / "png" / "webp" / "tiff" / "heif" / ""（未知）。
#[wasm_bindgen]
pub fn detect_type(bytes: &[u8]) -> String {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return "jpeg".into();
    }
    if bytes.len() >= 8 && bytes[..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        return "png".into();
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "webp".into();
    }
    if bytes.len() >= 4 && (bytes[..4] == [0x49, 0x49, 0x2A, 0x00] || bytes[..4] == [0x4D, 0x4D, 0x00, 0x2A]) {
        return "tiff".into();
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = String::from_utf8_lossy(&bytes[8..12]).to_ascii_lowercase();
        if brand.starts_with("heic")
            || brand.starts_with("heix")
            || brand.starts_with("hevc")
            || brand.starts_with("hevx")
            || brand.starts_with("mif1")
            || brand.starts_with("msf1")
            || brand.starts_with("avif")
        {
            return "heif".into();
        }
    }
    "".into()
}
