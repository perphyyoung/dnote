// release 构建不弹控制台窗口，别删
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dnote_lib::run();
}
