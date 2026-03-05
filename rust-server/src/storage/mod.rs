use crate::db::models::FileEntry;
use std::fs;
use std::path::{Path, PathBuf};

pub fn get_project_dir(data_dir: &str, project_id: &str) -> PathBuf {
    Path::new(data_dir).join(project_id)
}

pub fn get_file_path(data_dir: &str, project_id: &str, file_path: &str) -> PathBuf {
    // Prevent path traversal
    let normalized = file_path.replace("..", "").trim_start_matches('/').to_string();
    Path::new(data_dir).join(project_id).join(normalized)
}

pub fn ensure_project_dir(data_dir: &str, project_id: &str) {
    let dir = get_project_dir(data_dir, project_id);
    fs::create_dir_all(&dir).ok();
}

pub fn write_project_file(data_dir: &str, project_id: &str, file_path: &str, content: &[u8]) {
    let full_path = get_file_path(data_dir, project_id, file_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&full_path, content).ok();
}

pub fn read_project_file(data_dir: &str, project_id: &str, file_path: &str) -> Option<String> {
    let full_path = get_file_path(data_dir, project_id, file_path);
    fs::read_to_string(&full_path).ok()
}

pub fn read_project_file_binary(
    data_dir: &str,
    project_id: &str,
    file_path: &str,
) -> Option<Vec<u8>> {
    let full_path = get_file_path(data_dir, project_id, file_path);
    fs::read(&full_path).ok()
}

pub fn delete_project_file(data_dir: &str, project_id: &str, file_path: &str) -> bool {
    let full_path = get_file_path(data_dir, project_id, file_path);
    if !full_path.exists() {
        return false;
    }
    if full_path.is_dir() {
        fs::remove_dir_all(&full_path).is_ok()
    } else {
        fs::remove_file(&full_path).is_ok()
    }
}

pub fn delete_project_dir(data_dir: &str, project_id: &str) {
    let dir = get_project_dir(data_dir, project_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).ok();
    }
}

pub fn list_project_files(data_dir: &str, project_id: &str) -> Vec<FileEntry> {
    let dir = get_project_dir(data_dir, project_id);
    if !dir.exists() {
        return Vec::new();
    }

    let mut entries = Vec::new();
    walk_dir(&dir, "", &mut entries);
    entries
}

fn walk_dir(dir: &Path, prefix: &str, entries: &mut Vec<FileEntry>) {
    let items = match fs::read_dir(dir) {
        Ok(items) => items,
        Err(_) => return,
    };

    for item in items.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        let relative_path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", prefix, name)
        };

        let metadata = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_dir = metadata.is_dir();
        entries.push(FileEntry {
            path: relative_path.clone(),
            is_directory: is_dir,
            size_bytes: if is_dir { 0 } else { metadata.len() as i64 },
        });

        if is_dir {
            walk_dir(&item.path(), &relative_path, entries);
        }
    }
}
