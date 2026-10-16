//! `backup.rs` 的纯文件逻辑：打包 → 解包必须逐行相等（含空行），坏包必须报错而不是静默清空笔记。

use std::io::Write;
use std::path::PathBuf;

use super::{read_backup, write_backup, BackupError, MANIFEST_FILE};

fn temp_path(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "dnote-backup-test-{}-{tag}.zip",
        std::process::id()
    ))
}

#[test]
fn roundtrip_keeps_lines_including_empty_ones() {
    let path = temp_path("roundtrip");
    let main = vec!["第一行".to_string(), String::new(), "第三行".to_string()];
    let secondary: Vec<String> = vec![];

    write_backup(&path, &main, &secondary).expect("打包应成功");
    let (read_main, read_secondary) = read_backup(&path).expect("解包应成功");
    let _ = std::fs::remove_file(&path);

    assert_eq!(read_main, main, "主面板必须逐行相等（含末尾空行）");
    assert_eq!(read_secondary, secondary, "空面板也必须往返一致");
}

#[test]
fn non_zip_file_is_rejected() {
    let path = temp_path("notzip");
    std::fs::write(&path, b"this is not a zip").expect("写临时文件");

    let err = read_backup(&path).unwrap_err();
    let _ = std::fs::remove_file(&path);

    assert!(
        matches!(err, BackupError::Zip(_)),
        "应报 zip 解析失败，实际：{err}"
    );
}

#[test]
fn backup_without_notes_entry_is_rejected() {
    // 只放清单、不放笔记：导入必须拒绝，而不是把两块面板清空
    let path = temp_path("nomain");
    {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).expect("建临时 zip"));
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file(MANIFEST_FILE, opts).expect("写清单");
        zip.write_all(
            b"app = \"dnote\"\nformat = 1\nexported_at = \"2026-01-01T00:00:00+08:00\"\n\
              main_file = \"dnote.txt\"\nsecondary_file = \"dnote-secondary.txt\"\n",
        )
        .expect("写清单内容");
        zip.finish().expect("收尾");
    }

    let err = read_backup(&path).unwrap_err();
    let _ = std::fs::remove_file(&path);

    assert!(
        matches!(err, BackupError::MissingEntry(_)),
        "应报缺笔记条目，实际：{err}"
    );
}

#[test]
fn backup_without_manifest_is_rejected() {
    // 只有两个 txt、没有清单：必须拒绝 —— 缺了清单就无从判断哪份是主、哪份是次级
    // （这就是「不做宽容解析、只认自己的包」的判据，见 backup.rs 文件头）
    let path = temp_path("nomanifest");
    {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).expect("建临时 zip"));
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("dnote.txt", opts).expect("写主面板");
        zip.write_all("甲\n".as_bytes()).expect("写主面板内容");
        zip.start_file("dnote-secondary.txt", opts)
            .expect("写次级面板");
        zip.write_all("乙\n".as_bytes()).expect("写次级面板内容");
        zip.finish().expect("收尾");
    }

    let err = read_backup(&path).unwrap_err();
    let _ = std::fs::remove_file(&path);

    assert!(
        matches!(err, BackupError::MissingManifest),
        "缺清单必须拒绝，实际：{err}"
    );
}
