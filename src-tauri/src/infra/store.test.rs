use super::{decode_lines, encode_lines, Store};
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

/// 每个用例独占一个临时目录（tag + 进程内序号，避免并行用例互相覆盖）。
fn temp_store(tag: &str) -> Store {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("dnote-test-{}-{tag}-{seq}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    Store::new(dir.join("dnote.txt"))
}

fn lines(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn encode_appends_terminating_newline_to_every_line() {
    assert_eq!(encode_lines(&lines(&[])), "");
    assert_eq!(encode_lines(&lines(&["a"])), "a\n");
    assert_eq!(encode_lines(&lines(&["a", ""])), "a\n\n");
    assert_eq!(encode_lines(&lines(&["", "b"])), "\nb\n");
}

#[test]
fn decode_drops_only_the_empty_tail_from_terminating_newline() {
    assert_eq!(decode_lines(""), Vec::<String>::new());
    assert_eq!(decode_lines("a\n"), lines(&["a"]));
    // 末尾的空行是真实一行，不能被当成终止换行吃掉
    assert_eq!(decode_lines("a\n\n"), lines(&["a", ""]));
    assert_eq!(decode_lines("\n"), lines(&[""]));
}

#[test]
fn decode_tolerates_crlf_and_hand_edited_file() {
    assert_eq!(decode_lines("a\r\nb\r\n"), lines(&["a", "b"]));
    assert_eq!(decode_lines("a\r\nb"), lines(&["a", "b"]));
    assert_eq!(decode_lines("a"), lines(&["a"]));
}

#[test]
fn encode_decode_roundtrip_keeps_empty_lines() {
    for case in [
        lines(&[]),
        lines(&[""]),
        lines(&["a"]),
        lines(&["a", ""]),
        lines(&["", "", ""]),
        lines(&["a", "", "b", ""]),
        lines(&["带空格的 行 ", "第二行"]),
    ] {
        assert_eq!(
            decode_lines(&encode_lines(&case)),
            case,
            "往返失败: {case:?}"
        );
    }
}

#[test]
fn missing_file_reads_as_empty_list() {
    let store = temp_store("missing");
    assert_eq!(store.read_lines().unwrap(), Vec::<String>::new());
}

#[test]
fn write_then_read_keeps_lines_and_empty_lines() {
    let store = temp_store("roundtrip");
    let data = lines(&["第一行", "", "第三行", ""]);
    store.write_lines(&data).unwrap();
    assert_eq!(store.read_lines().unwrap(), data);
    // 原子写不留临时文件
    assert!(!store.path.with_extension("txt.tmp").exists());
}

#[test]
fn whole_file_rewrite_overwrites_previous_content() {
    let store = temp_store("overwrite");
    store.write_lines(&lines(&["a", "b", "c"])).unwrap();
    store.write_lines(&lines(&["c", "a"])).unwrap();
    assert_eq!(store.read_lines().unwrap(), lines(&["c", "a"]));

    // 清空后是零行，而不是「一个空行」
    store.write_lines(&[]).unwrap();
    assert_eq!(store.read_lines().unwrap(), Vec::<String>::new());
    assert_eq!(fs::read_to_string(&store.path).unwrap(), "");
}
