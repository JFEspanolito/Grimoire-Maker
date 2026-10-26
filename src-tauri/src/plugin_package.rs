//! Pure validation for external plugin packages: identity, manifest schema, archive entry paths.
//! Nothing here touches the filesystem or executes package content.
use serde::{Deserialize, Serialize};

pub const MAX_ARCHIVE_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
pub const MAX_ENTRIES: usize = 256;
pub const MAX_DEPTH: usize = 8;
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_EXTRACT_SECONDS: u64 = 30;
pub const MAIN_ENTRY: &str = "dist/index.js";
pub const MANIFEST_ENTRY: &str = "manifest.json";

/// Permissions the SDK knows. Anything else is rejected, never ignored.
pub const KNOWN_PERMISSIONS: &[&str] = &[
    "editor:zoom:read",
    "editor:zoom:write",
    "editor:geometry:read",
    "editor:guides:read",
    "editor:guides:write",
];

const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "conin$", "conout$", "com1", "com2", "com3", "com4", "com5",
    "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8",
    "lpt9",
];

/// True for a Windows device name, with or without extensions ("nul", "NUL.txt", "com1.a.b").
fn is_reserved(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or("").trim_end_matches(' ');
    RESERVED.contains(&stem.to_ascii_lowercase().as_str())
}

/// `^[a-z0-9][a-z0-9._-]{0,63}$` plus the Windows-safety and namespace rules of the spec.
pub fn validate_id(id: &str) -> Result<(), String> {
    let bytes = id.as_bytes();
    let valid_start = bytes.first().is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    let valid_rest = bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-'));
    if !valid_start || !valid_rest || bytes.len() > 64 {
        return Err("Plugin id must match ^[a-z0-9][a-z0-9._-]{0,63}$".into());
    }
    if id.ends_with('.') {
        return Err("Plugin id must not end with a dot".into());
    }
    if id.split('.').any(is_reserved) || is_reserved(id) {
        return Err("Plugin id is a reserved Windows device name".into());
    }
    if id == "builtin" || id.starts_with("builtin.") {
        return Err("The builtin.* namespace is reserved for plugins shipped with the application".into());
    }
    Ok(())
}

/// Validates one archive entry name and returns it normalized (no trailing slash).
/// Any hostile name rejects the whole package: callers must not skip and continue.
pub fn validate_entry_path(raw: &str) -> Result<String, String> {
    if raw.is_empty() {
        return Err("Archive entry has an empty name".into());
    }
    if raw.chars().any(|c| c.is_control() || matches!(c, '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')) {
        return Err(format!("Archive entry '{raw}' contains characters that are not allowed"));
    }
    if raw.starts_with('/') {
        return Err(format!("Archive entry '{raw}' is an absolute path"));
    }
    let path = raw.strip_suffix('/').unwrap_or(raw);
    let components: Vec<&str> = path.split('/').collect();
    if components.len() > MAX_DEPTH {
        return Err(format!("Archive entry '{raw}' is deeper than {MAX_DEPTH} components"));
    }
    for component in &components {
        if component.is_empty() || *component == "." || *component == ".." {
            return Err(format!("Archive entry '{raw}' has an unsafe path segment"));
        }
        if component.ends_with('.') || component.ends_with(' ') || component.len() > 100 {
            return Err(format!("Archive entry '{raw}' has an invalid component name"));
        }
        if is_reserved(component) {
            return Err(format!("Archive entry '{raw}' uses a reserved Windows device name"));
        }
    }
    Ok(path.to_string())
}

/// Only the manifest at the root and files under dist/ may exist in a package.
pub fn validate_layout(path: &str, is_dir: bool) -> Result<(), String> {
    let allowed = path == MANIFEST_ENTRY && !is_dir || path == "dist" && is_dir || path.starts_with("dist/");
    if allowed {
        Ok(())
    } else {
        Err(format!("Package entry '{path}' is outside manifest.json and dist/"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolbarContribution {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    pub command: String,
    #[serde(default)]
    pub options: Vec<SelectOption>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contributions {
    #[serde(default)]
    pub toolbar: Vec<ToolbarContribution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub sdk_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub main: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub contributions: Contributions,
}

fn bounded(label: &str, value: &str, max: usize) -> Result<(), String> {
    let count = value.chars().count();
    if count == 0 || count > max || value.chars().any(char::is_control) {
        return Err(format!("{label} must be 1-{max} printable characters"));
    }
    Ok(())
}

/// Dotted numeric version with an optional short pre-release tag, e.g. 1.0.0 or 1.2.3-beta.1.
fn validate_version(version: &str) -> Result<(), String> {
    let (core, pre) = match version.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (version, None),
    };
    let numbers: Vec<&str> = core.split('.').collect();
    let numeric = |part: &&str| !part.is_empty() && part.len() <= 9 && part.bytes().all(|b| b.is_ascii_digit());
    let pre_ok = pre.is_none_or(|tag| {
        !tag.is_empty() && tag.len() <= 16 && tag.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    });
    if numbers.len() != 3 || !numbers.iter().all(numeric) || !pre_ok {
        return Err("Plugin version must look like 1.2.3 or 1.2.3-beta.1".into());
    }
    Ok(())
}

fn validate_contributions(contributions: &Contributions) -> Result<(), String> {
    if contributions.toolbar.len() > 16 {
        return Err("A plugin may declare at most 16 toolbar contributions".into());
    }
    let mut seen = std::collections::HashSet::new();
    for item in &contributions.toolbar {
        validate_contribution_id(&item.id)?;
        if !seen.insert(item.id.as_str()) {
            return Err(format!("Duplicate contribution id '{}'", item.id));
        }
        bounded("Contribution label", &item.label, 40)?;
        validate_contribution_id(&item.command)?;
        match item.kind.as_str() {
            "button" if item.options.is_empty() => {}
            "select" if (1..=32).contains(&item.options.len()) => {}
            "button" => return Err("A button contribution cannot declare options".into()),
            "select" => return Err("A select contribution needs 1-32 options".into()),
            other => return Err(format!("Unsupported contribution type '{other}'")),
        }
        for option in &item.options {
            bounded("Option value", &option.value, 40)?;
            bounded("Option label", &option.label, 40)?;
        }
    }
    Ok(())
}

fn validate_contribution_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'_'));
    if ok { Ok(()) } else { Err(format!("Invalid contribution id '{id}'")) }
}

/// Parses and validates `manifest.json`. Unknown fields, permissions or versions are errors.
pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, String> {
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("manifest.json is larger than 64 KiB".into());
    }
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|error| format!("Invalid manifest.json: {error}"))?;
    if manifest.schema_version != 1 || manifest.sdk_version != 1 {
        return Err("Unsupported schemaVersion or sdkVersion (expected 1)".into());
    }
    validate_id(&manifest.id)?;
    bounded("Plugin name", &manifest.name, 64)?;
    bounded("Plugin author", &manifest.author, 64)?;
    bounded("Plugin description", &manifest.description, 280)?;
    validate_version(&manifest.version)?;
    if manifest.main != MAIN_ENTRY {
        return Err(format!("main must be exactly {MAIN_ENTRY}"));
    }
    if manifest.permissions.len() > KNOWN_PERMISSIONS.len() {
        return Err("Too many permissions declared".into());
    }
    let mut permissions = std::collections::HashSet::new();
    for permission in &manifest.permissions {
        if !KNOWN_PERMISSIONS.contains(&permission.as_str()) {
            return Err(format!("Unknown permission '{permission}'"));
        }
        if !permissions.insert(permission.as_str()) {
            return Err(format!("Duplicate permission '{permission}'"));
        }
    }
    validate_contributions(&manifest.contributions)?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(overrides: &[(&str, &str)]) -> String {
        let mut fields = vec![
            ("schemaVersion", "1"),
            ("sdkVersion", "1"),
            ("id", "\"community.zoom\""),
            ("name", "\"Editor Zoom\""),
            ("version", "\"1.0.0\""),
            ("author", "\"Example Author\""),
            ("description", "\"Zoom controls.\""),
            ("main", "\"dist/index.js\""),
            ("permissions", "[\"editor:zoom:read\",\"editor:zoom:write\"]"),
            (
                "contributions",
                "{\"toolbar\":[{\"id\":\"zoom-selector\",\"type\":\"select\",\"label\":\"Zoom\",\"command\":\"set-zoom\",\"options\":[{\"value\":\"100\",\"label\":\"100%\"}]}]}",
            ),
        ];
        for (key, value) in overrides {
            match fields.iter_mut().find(|(name, _)| name == key) {
                Some(field) => field.1 = value,
                None => fields.push((key, value)),
            }
        }
        let body: Vec<String> = fields.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect();
        format!("{{{}}}", body.join(","))
    }

    #[test]
    fn accepts_the_spec_example_manifest() {
        let parsed = parse_manifest(manifest(&[]).as_bytes()).unwrap();
        assert_eq!(parsed.id, "community.zoom");
        assert_eq!(parsed.contributions.toolbar[0].options.len(), 1);
    }

    #[test]
    fn rejects_unsafe_ids() {
        for id in [
            "", ".", "..", "-a", "Upper", "a/b", "a\\b", "a:b", "nul", "NUL", "con.txt", "com1.x", "lpt9",
            "ends.", "builtin.zoom", "builtin", &"a".repeat(65),
        ] {
            assert!(validate_id(id).is_err(), "id {id:?} should be rejected");
        }
        for id in ["community.zoom", "a", "0x", "my_plugin-2", &"a".repeat(64)] {
            assert!(validate_id(id).is_ok(), "id {id:?} should be accepted");
        }
    }

    #[test]
    fn rejects_hostile_entry_paths_instead_of_skipping_them() {
        for name in [
            "", "/abs", "C:/x", "a\\b", "../x", "a/../x", "a//b", "./a", "a/./b", "dist/a:stream", "dist/nul",
            "dist/NUL.txt", "dist/trail.", "dist/trail ", "a\0b", "dist/a?b", "a/b/c/d/e/f/g/h/i",
        ] {
            assert!(validate_entry_path(name).is_err(), "entry {name:?} should be rejected");
        }
        assert_eq!(validate_entry_path("dist/").unwrap(), "dist");
        assert_eq!(validate_entry_path("dist/index.js").unwrap(), "dist/index.js");
    }

    #[test]
    fn only_manifest_and_dist_are_allowed() {
        assert!(validate_layout("manifest.json", false).is_ok());
        assert!(validate_layout("dist", true).is_ok());
        assert!(validate_layout("dist/sub/a.js", false).is_ok());
        for path in ["README.md", "src/a.ts", "distx/a.js", "manifest.json2", "dist2"] {
            assert!(validate_layout(path, false).is_err(), "{path} should be outside the layout");
        }
        assert!(validate_layout("manifest.json", true).is_err());
    }

    #[test]
    fn manifest_schema_is_closed() {
        for (label, bad) in [
            ("unknown field", manifest(&[("extra", "1")])),
            ("future schema", manifest(&[("schemaVersion", "2")])),
            ("future sdk", manifest(&[("sdkVersion", "2")])),
            ("builtin id", manifest(&[("id", "\"builtin.zoom\"")])),
            ("bad main", manifest(&[("main", "\"dist/other.js\"")])),
            ("main traversal", manifest(&[("main", "\"../dist/index.js\"")])),
            ("unknown permission", manifest(&[("permissions", "[\"fs:read\"]")])),
            ("duplicate permission", manifest(&[("permissions", "[\"editor:zoom:read\",\"editor:zoom:read\"]")])),
            ("bad version", manifest(&[("version", "\"1.0\"")])),
            ("empty name", manifest(&[("name", "\"\"")])),
            ("control in name", manifest(&[("name", "\"a\\u0007b\"")])),
            ("bad type", manifest(&[("contributions", "{\"toolbar\":[{\"id\":\"a\",\"type\":\"html\",\"label\":\"A\",\"command\":\"c\"}]}")])),
            ("select without options", manifest(&[("contributions", "{\"toolbar\":[{\"id\":\"a\",\"type\":\"select\",\"label\":\"A\",\"command\":\"c\"}]}")])),
            ("duplicate contribution", manifest(&[("contributions", "{\"toolbar\":[{\"id\":\"a\",\"type\":\"button\",\"label\":\"A\",\"command\":\"c\"},{\"id\":\"a\",\"type\":\"button\",\"label\":\"B\",\"command\":\"c\"}]}")])),
            ("unknown contribution field", manifest(&[("contributions", "{\"toolbar\":[{\"id\":\"a\",\"type\":\"button\",\"label\":\"A\",\"command\":\"c\",\"onClick\":\"x\"}]}")])),
        ] {
            assert!(parse_manifest(label_bytes(&bad)).is_err(), "{label} should be rejected");
        }
        assert!(parse_manifest(b"not json").is_err());
        assert!(parse_manifest(&vec![b' '; MAX_MANIFEST_BYTES as usize + 1]).is_err());
    }

    fn label_bytes(text: &str) -> &[u8] {
        text.as_bytes()
    }

    #[test]
    fn accepts_prerelease_versions_and_buttons() {
        let doc = manifest(&[
            ("version", "\"1.2.3-beta.1\""),
            ("contributions", "{\"toolbar\":[{\"id\":\"go\",\"type\":\"button\",\"label\":\"Go\",\"command\":\"run\"}]}"),
        ]);
        assert!(parse_manifest(doc.as_bytes()).is_ok());
    }
}
