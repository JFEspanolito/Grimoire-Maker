#[path = "../src/fs_scope.rs"]
#[allow(dead_code)]
mod fs_scope;

mod tests {
    use crate::fs_scope::*;
    use tauri::scope::fs::Scope;
    use tauri::utils::config::FsScope;

    #[test]
    fn unix_scope_allows_only_the_named_dotfile() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let scope = Scope::new(
            &app,
            &FsScope::Scope {
                allow: vec![],
                deny: vec![],
                require_literal_leading_dot: Some(true),
            },
        )
        .unwrap();
        let root = std::env::temp_dir().join("grimoire-scope-[literal]");
        scope.allow_directory(&root, true).unwrap();
        assert!(scope.is_allowed(root.join("Welcome.md")));
        assert!(!scope.is_allowed(root.join(".examples-seeded")));
        allow_owned_file(&scope, &root, ".examples-seeded").unwrap();
        assert!(scope.is_allowed(root.join(".examples-seeded")));
        assert!(!scope.is_allowed(root.join(".env")));
        assert!(!scope.is_allowed(root.join(".ssh/id_rsa")));
        assert!(!scope.is_allowed(root.join(".git/config")));
        assert!(!scope.is_allowed(
            root.with_file_name("grimoire-scope-l")
                .join(".examples-seeded")
        ));
    }

    #[test]
    fn metadata_grants_require_an_authorized_root_and_exact_uuid() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let scope = Scope::new(
            &app,
            &FsScope::Scope {
                allow: vec![],
                deny: vec![],
                require_literal_leading_dot: Some(true),
            },
        )
        .unwrap();
        let root = std::env::temp_dir().join(format!(
            "grimoire-metadata-scope-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let token = "12345678-1234-4321-8123-123456789abc";
        assert!(prepare_metadata(&scope, &root, Some(token)).is_err());
        assert!(!scope.is_allowed(root.join(".grimoire-project.json")));
        scope.allow_directory(&root, true).unwrap();
        for bad in [
            "",
            "../.ssh/id_rsa",
            "*",
            "12345678-1234-4321-8123-123456789ab/",
        ] {
            assert!(prepare_metadata(&scope, &root, Some(bad)).is_err());
        }
        assert!(!scope.is_allowed(root.join(".grimoire-project.json")));
        prepare_metadata(&scope, &root, None).unwrap();
        assert!(scope.is_allowed(root.join(".grimoire-project.json")));
        let temporary = root.join(format!(".grimoire-project.json.{token}.tmp"));
        assert!(!scope.is_allowed(&temporary));
        prepare_metadata(&scope, &root, Some(token)).unwrap();
        assert!(scope.is_allowed(&temporary));
        assert!(!scope.is_allowed(root.join(".grimoire-project.json.other.tmp")));
        assert!(!scope.is_allowed(root.join(".env")));
        assert!(!scope.is_allowed(root.join(".ssh/id_rsa")));
        assert!(!scope.is_allowed(root.join(".git/config")));
        // Existing explicit denials still win over exact grants.
        scope.forbid_file(&temporary).unwrap();
        prepare_metadata(&scope, &root, Some(token)).unwrap();
        assert!(!scope.is_allowed(&temporary));
        std::fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn all_seed_markers_are_exact_file_grants() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let scope = Scope::new(
            &app,
            &FsScope::Scope {
                allow: vec![],
                deny: vec![],
                require_literal_leading_dot: Some(true),
            },
        )
        .unwrap();
        let root = std::env::temp_dir().join("grimoire-custom-library");
        for name in [
            ".examples-seeded",
            ".executable-plugins-v2-seeded",
            ".editorial-templates-v2-seeded",
            ".editorial-templates-v3-seeded",
            ".rol-adventures-snippets-v2-seeded",
            ".grimoire-theme-examples-v1",
            ".grimoire-theme-examples-v2",
        ] {
            assert!(!scope.is_allowed(root.join(name)));
            allow_owned_file(&scope, &root, name).unwrap();
            assert!(scope.is_allowed(root.join(name)));
            assert!(!scope.is_allowed(root.join(format!("{name}.other"))));
        }
        assert!(!scope.is_allowed(root.join(".env")));
    }

    #[cfg(unix)]
    #[test]
    fn metadata_symlinks_do_not_grant_their_targets() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let scope = Scope::new(
            &app,
            &FsScope::Scope {
                allow: vec![],
                deny: vec![],
                require_literal_leading_dot: Some(true),
            },
        )
        .unwrap();
        let root = std::env::temp_dir().join(format!("grimoire-scope-link-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let secret = root.join(".secret");
        std::fs::write(&secret, "keep").unwrap();
        let marker = root.join(".grimoire-project.json");
        std::os::unix::fs::symlink(&secret, &marker).unwrap();
        scope.allow_directory(&root, true).unwrap();
        assert!(prepare_metadata(&scope, &root, None).is_err());
        assert!(!scope.is_allowed(&secret));
        assert_eq!(std::fs::read_to_string(&secret).unwrap(), "keep");
        std::fs::remove_file(&marker).unwrap();
        std::fs::remove_file(&secret).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }
}
