use serde_json::Value;

fn main() {
    // 版本单一事实源在 package.json（tauri.conf.json 同样引用它）；Cargo 的 version
    // 字段不参与发布。编译期读取并注入，供 Rust 侧 env!("PACKAGE_VERSION") 使用。
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR 未设置");
    let pkg_path = std::path::Path::new(&manifest_dir).join("../package.json");
    let raw = std::fs::read_to_string(&pkg_path)
        .unwrap_or_else(|e| panic!("读取 {} 失败: {e}", pkg_path.display()));
    let pkg: Value = serde_json::from_str(&raw).expect("解析 package.json 失败");
    let version = pkg["version"]
        .as_str()
        .expect("package.json 缺少 version 字段");
    println!("cargo:rustc-env=PACKAGE_VERSION={version}");
    tauri_build::build()
}
