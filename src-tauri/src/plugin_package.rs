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
    "editor:insert",
];

const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "conin$", "conout$", "com1", "com2", "com3", "com4", "com5",
    "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8",
    "lpt9",
];

/// True for a Windows device name, with or without extensions ("nul", "NUL.txt", "com1.a.b").
fn is_reserved(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or("").trim_end_matches(' ');
    // Windows also treats the superscript digits (COM¹, LPT²) as device names.
    let folded: String = stem.chars().map(|c| match c { '¹' => '1', '²' => '2', '³' => '3', other => other }).collect();
    RESERVED.contains(&folded.to_ascii_lowercase().as_str())
}

/// `^[a-z0-9][a-z0-9._-]{0,63}$` plus the Windows-safety and namespace rules of the spec.
#[cfg(test)]
pub fn validate_id(id: &str) -> Result<(), String> {
    validate_id_for(id, false)
}

/// `allow_builtin` is true only for local package folders (never for imports).
pub fn validate_id_for(id: &str, allow_builtin: bool) -> Result<(), String> {
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
    // Names the managed root uses for its own files must never become a plugin folder.
    if matches!(id, "registry.json" | "registry.json.tmp" | "audit.log" | "audit.log.1") {
        return Err("Plugin id collides with a file used by the plugin manager".into());
    }
    if !allow_builtin && (id == "builtin" || id.starts_with("builtin.")) {
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
    /// Event name delivered to the plugin; absent for controls the host binds itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default)]
    pub options: Vec<SelectOption>,
    /// `main` (default) or `preview`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,
    /// Host state this control shows and changes: `zoom`, `surfaceZoom` or `rulerVisible`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    /// Host-evaluated condition: `markdown` enables the control only for Markdown files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    /// Declarative action the host runs on click; exclusive with `command` and `bind`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<ToolbarAction>,
}

/// Data the host executes itself; the plugin never runs code for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolbarAction {
    /// Only `insertMarkdown` exists.
    #[serde(rename = "type")]
    pub kind: String,
    pub markdown: String,
}

/// Ctrl+wheel zoom stepping implemented by the host; steps are whole percent values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BehaviorContribution {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub editor_steps: Vec<u32>,
    pub preview_steps: Vec<u32>,
}

/// A host-drawn overlay primitive (`ruler`: page measurements, margin and bleed boxes, guides).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayContribution {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// A host-drawn editor tool (`guidesMenu`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolContribution {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contributions {
    #[serde(default)]
    pub toolbar: Vec<ToolbarContribution>,
    #[serde(default)]
    pub behaviors: Vec<BehaviorContribution>,
    #[serde(default)]
    pub overlays: Vec<OverlayContribution>,
    #[serde(default)]
    pub tools: Vec<ToolContribution>,
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

/// Zero-width, bidi and other invisible format characters.
fn is_invisible(c: char) -> bool {
    matches!(c, '\u{AD}' | '\u{61C}' | '\u{180E}' | '\u{200B}'..='\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}')
}

fn bounded(label: &str, value: &str, max: usize) -> Result<(), String> {
    let count = value.chars().count();
    // Control and invisible/bidi format characters could make the consent text lie.
    if count == 0 || count > max || value.chars().any(|c| c.is_control() || is_invisible(c)) {
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

fn needs(permissions: &[String], required: &[&str], what: &str) -> Result<(), String> {
    for permission in required {
        if !permissions.iter().any(|granted| granted == permission) {
            return Err(format!("{what} requires the {permission} permission"));
        }
    }
    Ok(())
}

fn validate_steps(label: &str, steps: &[u32], min: u32, max: u32) -> Result<(), String> {
    let ordered = steps.windows(2).all(|pair| pair[0] < pair[1]);
    if !(2..=32).contains(&steps.len()) || !ordered || steps.iter().any(|step| *step < min || *step > max) {
        return Err(format!("{label} must be 2-32 ascending percentages between {min} and {max}"));
    }
    Ok(())
}

pub const MAX_INSERT_MARKDOWN_CHARS: usize = 8192;
/// How many times character references and percent escapes are peeled off before the text counts as hostile.
const MAX_DECODE_ROUNDS: usize = 10;
/// Schemes whose appearance anywhere in the text (even outside link syntax) is refused.
const URL_SCHEMES: &[&str] = &[
    "http", "https", "ftp", "ftps", "file", "ws", "wss", "data", "blob", "javascript", "vbscript", "asset", "tauri", "ipc",
];

/// Named character references an attacker could use to hide a scheme or a tag (lower case).
const NAMED_ENTITIES: &[(&str, char)] = &[
    ("colon", ':'), ("sol", '/'), ("bsol", '\\'), ("amp", '&'), ("lt", '<'), ("gt", '>'), ("quot", '"'), ("apos", '\''),
    ("tab", '\t'), ("newline", '\n'), ("lpar", '('), ("rpar", ')'), ("equals", '='), ("percnt", '%'), ("num", '#'),
    ("excl", '!'), ("comma", ','), ("period", '.'), ("lsqb", '['), ("rsqb", ']'), ("nbsp", ' '),
];

/// White space as Unicode defines it (the same set JavaScript's `trim` uses, minus U+0085 and U+FEFF which are rejected earlier).
fn is_space(c: char) -> bool {
    matches!(c, '\t'..='\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}')
}

/// Characters a browser drops or ignores inside an address.
fn is_hidden(c: char) -> bool {
    c.is_control() || is_invisible(c)
}

/// Full-width ASCII (`ｈｔｔｐ：`) becomes ASCII and ASCII letters become lower case; nothing else changes.
fn fold(c: char) -> char {
    let c = if ('\u{FF01}'..='\u{FF5E}').contains(&c) { char::from_u32(c as u32 - 0xFEE0).unwrap_or(c) } else { c };
    c.to_ascii_lowercase()
}

/// One character reference at the start of `rest` (which begins with `&`): the character and the chars consumed.
/// Numeric references take any number of digits and an optional `;`; named ones match by longest known prefix.
fn entity_at(rest: &[char]) -> Option<(char, usize)> {
    if rest.get(1) == Some(&'#') {
        let (radix, start) = if matches!(rest.get(2), Some('x') | Some('X')) { (16, 3) } else { (10, 2) };
        let (mut end, mut value) = (start, 0u32);
        while end < rest.len() {
            let Some(digit) = rest[end].to_digit(radix) else { break };
            value = (value * radix + digit).min(0x11_0000);
            end += 1;
        }
        if end == start {
            return None;
        }
        let used = if rest.get(end) == Some(&';') { end + 1 } else { end };
        return char::from_u32(value).map(|c| (c, used));
    }
    let run: String = rest[1..].iter().take(16).take_while(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect();
    let (name, decoded) = NAMED_ENTITIES
        .iter()
        .filter(|(known, _)| run.starts_with(known))
        .max_by_key(|(known, _)| known.len())?;
    let end = 1 + name.len();
    let used = if run.len() == name.len() && rest.get(end) == Some(&';') { end + 1 } else { end };
    Some((*decoded, used))
}

fn entity_decode(chars: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '&' {
            if let Some((decoded, used)) = entity_at(&chars[i..]) {
                out.push(decoded);
                i += used;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// `%XX` escapes of ASCII characters; anything else stays as written.
fn percent_decode(chars: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '%' && i + 2 < chars.len() {
            if let (Some(hi), Some(lo)) = (chars[i + 1].to_digit(16), chars[i + 2].to_digit(16)) {
                let value = hi * 16 + lo;
                if value < 0x80 {
                    out.push(char::from_u32(value).unwrap_or('%'));
                    i += 3;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// A backslash before ASCII punctuation is an escape in Markdown: drop the backslash.
fn unescape(chars: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1].is_ascii_punctuation() {
            out.push(chars[i + 1]);
            i += 2;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// Every stage of decoding `start` (character references, then percent escapes; backslash escapes too when
/// `escapes`) until nothing changes, or None when it is still changing after `MAX_DECODE_ROUNDS`.
fn decode_chain(start: Vec<char>, escapes: bool) -> Option<Vec<Vec<char>>> {
    let step = |chars: &[char]| {
        let base = if escapes { unescape(chars) } else { chars.to_vec() };
        percent_decode(&entity_decode(&base))
    };
    let mut stages = vec![start];
    for _ in 0..=MAX_DECODE_ROUNDS {
        let next = step(stages.last().expect("one stage"));
        if &next == stages.last().expect("one stage") {
            return Some(stages);
        }
        stages.push(next);
    }
    None
}

/// A `<` followed (after optional white space) by a letter, `/`, `!` or `?` starts a tag, comment, declaration or autolink.
fn has_html(view: &[char]) -> bool {
    view.iter().enumerate().any(|(i, c)| {
        *c == '<'
            && view[i + 1..].iter().find(|n| !is_space(**n)).is_some_and(|n| n.is_ascii_alphabetic() || matches!(n, '/' | '!' | '?'))
    })
}

fn skippable(c: char) -> bool {
    is_space(c) || is_hidden(c) || c == '\\'
}

/// Matches `word` at `from` letting ignorable characters sit between its letters; the index after it.
fn match_word(folded: &[char], from: usize, word: &str) -> Option<usize> {
    let mut j = from;
    for (k, expected) in word.chars().enumerate() {
        if k > 0 {
            while j < folded.len() && skippable(folded[j]) {
                j += 1;
            }
        }
        if folded.get(j) != Some(&expected) {
            return None;
        }
        j += 1;
    }
    Some(j)
}

/// A run of host characters that contains a dot followed by a letter or digit, e.g. `x.com`.
fn looks_like_host(chars: &[char]) -> bool {
    let run: Vec<char> = chars.iter().copied().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-')).collect();
    run.windows(2).any(|pair| pair[0] == '.' && pair[1].is_ascii_alphanumeric())
}

/// A listed scheme followed by `:`, a `www.` host or a `//host.tld` target anywhere in the text.
fn bare_address(view: &[char]) -> Option<&'static str> {
    let folded: Vec<char> = view.iter().map(|c| fold(*c)).collect();
    for i in 0..folded.len() {
        if i > 0 && folded[i - 1].is_ascii_alphanumeric() {
            continue;
        }
        for scheme in URL_SCHEMES {
            if folded[i] != scheme.chars().next().unwrap_or(' ') {
                continue;
            }
            if let Some(mut j) = match_word(&folded, i, scheme) {
                while j < folded.len() && skippable(folded[j]) {
                    j += 1;
                }
                if folded.get(j) == Some(&':') {
                    return Some("a web, file, script or app address (http:, https:, data:, javascript:, asset:, tauri: ...)");
                }
            }
        }
        if folded[i] == 'w' {
            if let Some(j) = match_word(&folded, i, "www.") {
                if looks_like_host(&folded[j..]) {
                    return Some("a www. address");
                }
            }
        }
        let slash = |k: usize| matches!(folded.get(k), Some('/') | Some('\\'));
        if slash(i) && slash(i + 1) && looks_like_host(&folded[i + 2..]) {
            return Some("a //host address");
        }
    }
    None
}

/// The destination that starts at `start` (just after `](` or `]:`) and where it ended: `<...>` or a token that
/// stops at white space or at the unbalanced `)` that closes the link.
fn parse_destination(view: &[char], start: usize) -> (Vec<char>, usize) {
    let n = view.len();
    let mut j = start;
    while j < n && is_space(view[j]) {
        j += 1;
    }
    let mut dest = Vec::new();
    if j < n && view[j] == '<' {
        j += 1;
        while j < n && view[j] != '>' {
            dest.push(view[j]);
            j += 1;
        }
        return (dest, j);
    }
    let mut depth = 0usize;
    while j < n && !is_space(view[j]) {
        match view[j] {
            '(' => depth += 1,
            ')' if depth == 0 => break,
            ')' => depth -= 1,
            _ => {}
        }
        dest.push(view[j]);
        j += 1;
    }
    (dest, j)
}

/// Every inline `](dest)` (links and images) and every `[label]: dest` definition at the start of a line.
fn destinations(view: &[char]) -> Vec<Vec<char>> {
    let n = view.len();
    let mut found = Vec::new();
    let mut i = 0;
    while i < n {
        if i == 0 || matches!(view[i - 1], '\n' | '\r') {
            let mut j = i;
            while j < n && matches!(view[j], ' ' | '\t') {
                j += 1;
            }
            if j < n && view[j] == '[' {
                let mut k = j + 1;
                while k + 1 < n && !matches!(view[k], '\n' | '\r') && !(view[k] == ']' && view[k + 1] == ':') {
                    k += 1;
                }
                if k + 1 < n && view[k] == ']' && view[k + 1] == ':' {
                    found.push(parse_destination(view, k + 2).0);
                }
            }
        }
        if view[i] == ']' && view.get(i + 1) == Some(&'(') {
            let (dest, end) = parse_destination(view, i + 2);
            found.push(dest);
            i = end.max(i + 1);
            continue;
        }
        i += 1;
    }
    found
}

/// One decoded stage of a destination is safe only when it is empty, an anchor or a relative path: it does not start
/// with `/` (absolute or protocol-relative) and has no `:` before its first `/`, `?` or `#` (any scheme, `c:`...).
fn stage_is_unsafe(stage: &[char]) -> bool {
    let cleaned: Vec<char> = stage
        .iter()
        .filter(|c| !is_space(**c) && !is_hidden(**c))
        .map(|c| fold(*c))
        .map(|c| if c == '\\' { '/' } else { c })
        .collect();
    let start = cleaned.iter().position(|c| !matches!(c, '"' | '\'' | '<')).unwrap_or(cleaned.len());
    let end = cleaned.iter().rposition(|c| !matches!(c, '"' | '\'' | '>')).map_or(start, |p| p + 1).max(start);
    let cleaned = &cleaned[start..end];
    if cleaned.first() == Some(&'/') {
        return true;
    }
    cleaned.iter().find(|c| matches!(c, ':' | '/' | '?' | '#')) == Some(&':')
}

fn destination_is_unsafe(raw: &[char]) -> bool {
    let trim = |c: &char| is_space(*c) || matches!(c, '"' | '\'');
    let from = raw.iter().position(|c| !trim(c)).unwrap_or(raw.len());
    let to = raw.iter().rposition(|c| !trim(c)).map_or(from, |p| p + 1);
    match decode_chain(raw[from..to.max(from)].to_vec(), true) {
        Some(stages) => stages.iter().any(|stage| stage_is_unsafe(stage)),
        None => true,
    }
}

/// Names the first construct of one decoded view that Markdown insertion must not carry, if any.
fn view_problem(view: &[char]) -> Option<&'static str> {
    if has_html(view) {
        return Some("raw HTML (a < followed by a letter, /, ! or ?), including tags, comments and <https://...> links");
    }
    if let Some(found) = bare_address(view) {
        return Some(found);
    }
    if destinations(view).iter().any(|dest| destination_is_unsafe(dest)) {
        return Some("a link or image target that is not a relative path or an anchor (#...)");
    }
    None
}

/// Allow-list for text a button inserts into the page, judged on the raw text and on every further decoding of it
/// (character references with any number of digits, percent escapes, backslash escapes), so an encoded address is still found.
///
/// Rules: 1..8192 characters, only `\n \r \t` as control characters, no invisible or direction characters, not blank;
/// no raw HTML (a `<` followed by white space and then a letter, `/`, `!` or `?`); every Markdown link, image and
/// `[label]: target` is an anchor or a relative path (no scheme of any kind, no leading `/`, no `//host`, no drive letter);
/// and no bare `http:`/`https:`/`ftp:`/`ftps:`/`file:`/`ws:`/`wss:`/`data:`/`blob:`/`javascript:`/`vbscript:`/`asset:`/
/// `tauri:`/`ipc:` scheme, `www.host.tld` or `//host.tld` anywhere, even in plain prose.
///
/// False positives, on purpose: prose such as "data: 5" or "File: notes", code or placeholders such as `Vec<String>` or
/// `<name>`, and the words listed above followed by a colon are refused; rephrase them. A `<` before a digit, `=` or a space
/// and a digit (`a < 3`) is fine.
fn validate_insert_markdown(text: &str) -> Result<(), String> {
    let count = text.chars().count();
    if count == 0 || count > MAX_INSERT_MARKDOWN_CHARS {
        return Err(format!("Inserted Markdown must be 1-{MAX_INSERT_MARKDOWN_CHARS} characters"));
    }
    if text.chars().any(|c| (c.is_control() && !matches!(c, '\n' | '\r' | '\t')) || is_invisible(c)) {
        return Err("Inserted Markdown contains control, zero-width or direction-changing characters".into());
    }
    if text.chars().all(is_space) {
        return Err("Inserted Markdown cannot be only blank space".into());
    }
    let Some(views) = decode_chain(text.chars().collect(), false) else {
        return Err("Inserted Markdown is encoded too many times to be checked".into());
    };
    for view in &views {
        if let Some(found) = view_problem(view) {
            return Err(format!("Inserted Markdown must not contain {found}"));
        }
    }
    Ok(())
}

fn validate_action_item(item: &ToolbarContribution, action: &ToolbarAction, sdk_version: u32, permissions: &[String]) -> Result<(), String> {
    if sdk_version < 2 {
        return Err("Actions require sdkVersion 2".into());
    }
    if item.command.is_some() || item.bind.is_some() {
        return Err("A control declares exactly one of command, bind or action".into());
    }
    if item.kind != "button" || !item.options.is_empty() {
        return Err("An action belongs to a button without options".into());
    }
    if !matches!(item.slot.as_deref(), None | Some("main")) {
        return Err("An action button must use the main slot".into());
    }
    if !matches!(item.when.as_deref(), None | Some("markdown")) {
        return Err("Unsupported 'when' condition".into());
    }
    if action.kind != "insertMarkdown" {
        return Err(format!("Unsupported action type '{}'", action.kind));
    }
    needs(permissions, &["editor:insert"], "An insertMarkdown action")?;
    validate_insert_markdown(&action.markdown)
}

fn validate_toolbar_item(item: &ToolbarContribution, sdk_version: u32, permissions: &[String]) -> Result<(), String> {
    bounded("Contribution label", &item.label, 40)?;
    if let Some(action) = &item.action {
        return validate_action_item(item, action, sdk_version, permissions);
    }
    let extended = item.slot.is_some() || item.bind.is_some() || item.when.is_some() || item.kind == "toggle";
    if extended && sdk_version < 2 {
        return Err("Slots, bound controls and toggles require sdkVersion 2".into());
    }
    match item.slot.as_deref() {
        None | Some("main") | Some("preview") => {}
        Some(other) => return Err(format!("Unsupported slot '{other}'")),
    }
    if !matches!(item.when.as_deref(), None | Some("markdown")) {
        return Err("Unsupported 'when' condition".into());
    }
    let bind = item.bind.as_deref();
    match (item.kind.as_str(), bind) {
        ("button", None) if item.options.is_empty() => {}
        ("select", None) if (1..=32).contains(&item.options.len()) => {}
        ("select", Some("zoom")) | ("select", Some("surfaceZoom")) if (1..=32).contains(&item.options.len()) => {
            needs(permissions, &["editor:zoom:write"], "A zoom-bound control")?;
        }
        ("toggle", Some("rulerVisible")) if item.options.is_empty() => {}
        ("button", Some(_)) | ("toggle", _) => return Err("Unsupported control binding".into()),
        ("button", None) => return Err("A button contribution cannot declare options".into()),
        ("select", None) => return Err("A select contribution needs 1-32 options".into()),
        ("select", Some("zoom")) | ("select", Some("surfaceZoom")) => return Err("A bound select needs 1-32 options".into()),
        ("select", Some(other)) => return Err(format!("Unsupported control binding '{other}'")),
        (other, _) => return Err(format!("Unsupported contribution type '{other}'")),
    }
    // A preview control exists only to show the preview surface's own zoom.
    if (item.slot.as_deref() == Some("preview")) != (bind == Some("surfaceZoom")) {
        return Err("The preview slot is for surfaceZoom controls only, and surfaceZoom controls must use it".into());
    }
    match (&item.command, bind) {
        (Some(command), None) => validate_contribution_id(command)?,
        (None, Some(_)) => {}
        _ => return Err("A control declares a command, or a host binding, but not both and not neither".into()),
    }
    for option in &item.options {
        bounded("Option value", &option.value, 40)?;
        bounded("Option label", &option.label, 40)?;
    }
    Ok(())
}

fn validate_contributions(contributions: &Contributions, sdk_version: u32, permissions: &[String]) -> Result<(), String> {
    if contributions.toolbar.len() > 16 {
        return Err("A plugin may declare at most 16 toolbar contributions".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut claim = |id: &str| -> Result<(), String> {
        validate_contribution_id(id)?;
        if seen.insert(id.to_string()) { Ok(()) } else { Err(format!("Duplicate contribution id '{id}'")) }
    };
    for item in &contributions.toolbar {
        claim(&item.id)?;
        validate_toolbar_item(item, sdk_version, permissions)?;
    }
    let declared_extended = !contributions.behaviors.is_empty() || !contributions.overlays.is_empty() || !contributions.tools.is_empty();
    if declared_extended && sdk_version < 2 {
        return Err("Behaviors, overlays and tools require sdkVersion 2".into());
    }
    if contributions.behaviors.len() > 4 || contributions.overlays.len() > 2 || contributions.tools.len() > 4 {
        return Err("Too many behavior, overlay or tool contributions".into());
    }
    for behavior in &contributions.behaviors {
        claim(&behavior.id)?;
        if behavior.kind != "wheelZoom" {
            return Err(format!("Unsupported behavior type '{}'", behavior.kind));
        }
        needs(permissions, &["editor:zoom:write"], "The wheelZoom behavior")?;
        validate_steps("editorSteps", &behavior.editor_steps, 25, 300)?;
        validate_steps("previewSteps", &behavior.preview_steps, 25, 300)?;
    }
    for overlay in &contributions.overlays {
        claim(&overlay.id)?;
        if overlay.kind != "ruler" {
            return Err(format!("Unsupported overlay type '{}'", overlay.kind));
        }
        needs(permissions, &["editor:geometry:read", "editor:guides:read", "editor:guides:write"], "The ruler overlay")?;
    }
    for tool in &contributions.tools {
        claim(&tool.id)?;
        if tool.kind != "guidesMenu" {
            return Err(format!("Unsupported tool type '{}'", tool.kind));
        }
        bounded("Tool label", &tool.label, 40)?;
        needs(permissions, &["editor:guides:read", "editor:guides:write"], "The guidesMenu tool")?;
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
    parse_manifest_for(bytes, false)
}

/// `allow_builtin` lets local package folders use the reserved `builtin.*` ids.
pub fn parse_manifest_for(bytes: &[u8], allow_builtin: bool) -> Result<Manifest, String> {
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("manifest.json is larger than 64 KiB".into());
    }
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|error| format!("Invalid manifest.json: {error}"))?;
    if manifest.schema_version != 1 || !(1..=2).contains(&manifest.sdk_version) {
        return Err("Unsupported schemaVersion or sdkVersion (expected schemaVersion 1, sdkVersion 1 or 2)".into());
    }
    validate_id_for(&manifest.id, allow_builtin)?;
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
    validate_contributions(&manifest.contributions, manifest.sdk_version, &manifest.permissions)?;
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
            "ends.", "builtin.zoom", "builtin", "registry.json", "audit.log", &"a".repeat(65),
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
            "dist/NUL.txt", "dist/COM¹.js", "dist/lpt².txt", "dist/trail.", "dist/trail ", "a\0b", "dist/a?b", "a/b/c/d/e/f/g/h/i",
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
            ("future sdk", manifest(&[("sdkVersion", "3")])),
            ("builtin id", manifest(&[("id", "\"builtin.zoom\"")])),
            ("bad main", manifest(&[("main", "\"dist/other.js\"")])),
            ("main traversal", manifest(&[("main", "\"../dist/index.js\"")])),
            ("unknown permission", manifest(&[("permissions", "[\"fs:read\"]")])),
            ("duplicate permission", manifest(&[("permissions", "[\"editor:zoom:read\",\"editor:zoom:read\"]")])),
            ("bad version", manifest(&[("version", "\"1.0\"")])),
            ("empty name", manifest(&[("name", "\"\"")])),
            ("control in name", manifest(&[("name", "\"a\\u0007b\"")])),
            ("bidi override in name", manifest(&[("name", "\"Trusted\\u202etpircs\"")])),
            ("zero-width in author", manifest(&[("author", "\"Ev\\u200bil\"")])),
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

    const ZOOM: &str = include_str!("../../src/assets/mods/Plugins/zoom/manifest.json");
    const RULER: &str = include_str!("../../src/assets/mods/Plugins/pixel-ruler/manifest.json");

    fn v2(permissions: &str, contributions: &str) -> String {
        manifest(&[("sdkVersion", "2"), ("permissions", permissions), ("contributions", contributions)])
    }

    #[test]
    fn the_example_manifests_are_valid_only_as_local_packages() {
        for text in [ZOOM, RULER] {
            assert!(parse_manifest_for(text.as_bytes(), true).is_ok(), "{:?}", parse_manifest_for(text.as_bytes(), true));
            assert!(parse_manifest(text.as_bytes()).is_err(), "an imported package may never claim builtin.*");
        }
    }

    #[test]
    fn sdk_2_declarative_contributions_are_accepted_with_their_permissions() {
        let zoom = "[\"editor:zoom:read\",\"editor:zoom:write\"]";
        let guides = "[\"editor:geometry:read\",\"editor:guides:read\",\"editor:guides:write\"]";
        let ok = [
            v2(zoom, "{\"toolbar\":[{\"id\":\"z\",\"type\":\"select\",\"label\":\"Zoom\",\"bind\":\"zoom\",\"when\":\"markdown\",\"options\":[{\"value\":\"1\",\"label\":\"100%\"}]}]}"),
            v2(zoom, "{\"toolbar\":[{\"id\":\"p\",\"type\":\"select\",\"label\":\"Zoom\",\"bind\":\"surfaceZoom\",\"slot\":\"preview\",\"options\":[{\"value\":\"1\",\"label\":\"100%\"}]}]}"),
            v2(zoom, "{\"behaviors\":[{\"id\":\"w\",\"type\":\"wheelZoom\",\"editorSteps\":[50,100],\"previewSteps\":[40,100]}]}"),
            v2(guides, "{\"toolbar\":[{\"id\":\"t\",\"type\":\"toggle\",\"label\":\"Ruler\",\"bind\":\"rulerVisible\"}],\"overlays\":[{\"id\":\"r\",\"type\":\"ruler\"}],\"tools\":[{\"id\":\"g\",\"type\":\"guidesMenu\",\"label\":\"Guides\"}]}"),
        ];
        for doc in &ok {
            assert!(parse_manifest(doc.as_bytes()).is_ok(), "{doc}: {:?}", parse_manifest(doc.as_bytes()));
        }
    }

    #[test]
    fn sdk_2_contributions_are_refused_without_the_permission_or_the_sdk() {
        let none = "[]";
        let zoom_read = "[\"editor:zoom:read\"]";
        let select = |bind: &str, extra: &str| format!("{{\"toolbar\":[{{\"id\":\"z\",\"type\":\"select\",\"label\":\"Zoom\",\"bind\":\"{bind}\"{extra},\"options\":[{{\"value\":\"1\",\"label\":\"100%\"}}]}}]}}");
        let bad = [
            ("bound control without zoom:write", v2(zoom_read, &select("zoom", ""))),
            ("surface control outside the preview slot", v2("[\"editor:zoom:write\"]", &select("surfaceZoom", ""))),
            ("preview slot with a plain zoom bind", v2("[\"editor:zoom:write\"]", &select("zoom", ",\"slot\":\"preview\""))),
            ("unknown bind", v2("[\"editor:zoom:write\"]", &select("document", ""))),
            ("unknown condition", v2("[\"editor:zoom:write\"]", &select("zoom", ",\"when\":\"always\""))),
            ("wheel without zoom:write", v2(zoom_read, "{\"behaviors\":[{\"id\":\"w\",\"type\":\"wheelZoom\",\"editorSteps\":[50,100],\"previewSteps\":[40,100]}]}")),
            ("descending steps", v2("[\"editor:zoom:write\"]", "{\"behaviors\":[{\"id\":\"w\",\"type\":\"wheelZoom\",\"editorSteps\":[100,50],\"previewSteps\":[40,100]}]}")),
            ("steps out of range", v2("[\"editor:zoom:write\"]", "{\"behaviors\":[{\"id\":\"w\",\"type\":\"wheelZoom\",\"editorSteps\":[10,5000],\"previewSteps\":[40,100]}]}")),
            ("ruler without guides:write", v2("[\"editor:geometry:read\",\"editor:guides:read\"]", "{\"overlays\":[{\"id\":\"r\",\"type\":\"ruler\"}]}")),
            ("guides menu without permissions", v2(none, "{\"tools\":[{\"id\":\"g\",\"type\":\"guidesMenu\",\"label\":\"Guides\"}]}")),
            ("unknown overlay", v2(none, "{\"overlays\":[{\"id\":\"r\",\"type\":\"html\"}]}")),
            ("toggle bound to zoom", v2("[\"editor:zoom:write\"]", "{\"toolbar\":[{\"id\":\"t\",\"type\":\"toggle\",\"label\":\"T\",\"bind\":\"zoom\"}]}")),
            ("bound control with a command", v2("[\"editor:zoom:write\"]", &select("zoom", ",\"command\":\"go\""))),
            ("control with neither", v2(none, "{\"toolbar\":[{\"id\":\"b\",\"type\":\"button\",\"label\":\"B\"}]}")),
            ("duplicate id across kinds", v2("[\"editor:geometry:read\",\"editor:guides:read\",\"editor:guides:write\"]", "{\"overlays\":[{\"id\":\"x\",\"type\":\"ruler\"}],\"tools\":[{\"id\":\"x\",\"type\":\"guidesMenu\",\"label\":\"G\"}]}")),
            ("sdk 1 with a toggle", manifest(&[("permissions", none), ("contributions", "{\"toolbar\":[{\"id\":\"t\",\"type\":\"toggle\",\"label\":\"T\",\"bind\":\"rulerVisible\"}]}")])),
            ("sdk 1 with an overlay", manifest(&[("permissions", "[\"editor:geometry:read\",\"editor:guides:read\",\"editor:guides:write\"]"), ("contributions", "{\"overlays\":[{\"id\":\"r\",\"type\":\"ruler\"}]}")])),
        ];
        for (label, doc) in &bad {
            assert!(parse_manifest(doc.as_bytes()).is_err(), "{label} should be rejected");
        }
    }

    // ---- insertMarkdown actions -------------------------------------------------------------

    fn action_manifest(item: serde_json::Value, sdk: u32, permissions: &[&str]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1, "sdkVersion": sdk, "id": "custom.insert", "name": "Insert", "version": "1.0.0",
            "author": "Me", "description": "Inserts text.", "main": "dist/index.js",
            "permissions": permissions,
            "contributions": { "toolbar": [item] }
        }))
        .unwrap()
    }

    fn insert_item(markdown: &str) -> serde_json::Value {
        serde_json::json!({ "id": "insert-1", "type": "button", "label": "Insert", "action": { "type": "insertMarkdown", "markdown": markdown } })
    }

    fn parse_insert(markdown: &str) -> Result<Manifest, String> {
        parse_manifest(&action_manifest(insert_item(markdown), 2, &["editor:insert"]))
    }

    #[test]
    fn the_shared_insert_fixture_parses() {
        let parsed = parse_manifest(include_str!("../../src/lib/fixtures/insert-plugin.manifest.json").as_bytes()).unwrap();
        assert_eq!(parsed.id, "custom.encounter-tools");
        assert_eq!(parsed.permissions, vec!["editor:insert".to_string()]);
        let action = parsed.contributions.toolbar[0].action.as_ref().unwrap();
        assert_eq!(action.kind, "insertMarkdown");
        assert!(action.markdown.starts_with("## Encounter\n\n| d6 | Result |"));
    }

    #[test]
    fn editor_insert_is_a_known_permission() {
        assert!(KNOWN_PERMISSIONS.contains(&"editor:insert"));
    }

    #[test]
    fn accepts_plain_markdown_and_safe_links() {
        for markdown in [
            "## Title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
            "Tabs\tand\r\nCRLF are fine",
            "A [relative link](./notes/a.md) and an [anchor](#section) and ![img](assets/map.png)",
            "The word http alone, or https without a colon, is only text",
            "Metadata: the field name data is not an address; neither is profile: or a // comment",
            "Wizard's action = 3 and person=2 and 5 > 2 and a < 3 and x<3",
            "Roll: 2d6 (data is not an address) and a [link](./a:b.md) or [x](<./a b.md>) or [top](#top) or [empty]()",
            "Fractions like 1/2 and a path a//b are text",
            &"x".repeat(MAX_INSERT_MARKDOWN_CHARS),
        ] {
            assert!(parse_insert(markdown).is_ok(), "{markdown:?} should be accepted: {:?}", parse_insert(markdown).err());
        }
    }

    #[test]
    fn the_action_survives_serialization_for_the_host() {
        let parsed = parse_insert("Hello").unwrap();
        let json = serde_json::to_value(&parsed.contributions.toolbar[0]).unwrap();
        assert_eq!(json["action"]["type"], "insertMarkdown");
        assert_eq!(json["action"]["markdown"], "Hello");
        let plain = serde_json::to_value(&parse_manifest(manifest(&[]).as_bytes()).unwrap().contributions.toolbar[0]).unwrap();
        assert!(plain.get("action").is_none());
    }

    #[test]
    fn rejects_remote_and_active_markdown() {
        let bad = [
            "[x](https://a.example)", "[x](http://a.example)", "see HTTP://A.EXAMPLE", "ftp://host/file", "file:///c:/x",
            "[x](javascript:alert(1))", "[x](JaVaScRiPt:alert(1))", "[x](vbscript:run)", "![i](data:image/png;base64,AAAA)",
            "[x](data:text/html,<b>)", "[x](//evil.example/a)", "![i](//evil.example/a.png)", "[x](<//evil.example>)",
            "[x](\\\\evil.example\\a)", "[x]: //evil.example", "<img src=//evil.example/a.png>", "<img src=\"//evil.example\">",
            "<script>alert(1)</script>", "<SCRIPT src=x>", "<iframe src=x></iframe>", "<object data=x>", "<embed src=x>",
            "<link rel=stylesheet href=x>", "<meta http-equiv=refresh>", "<style>a{}</style>", "<base href=x>",
            "<form action=x>", "</script>", "<img src=x onerror=alert(1)>", "<b onclick = \"x\">", "<svg/onload=alert(1)>",
            // encoded forms
            "&#104;ttp://x.example", "&#x68;ttp://x.example", "&#104ttp://x.example", "jav&#x61;script:alert(1)",
            "%68ttp://x.example", "%68%74%74%70%73%3A%2F%2Fx.example", "[x](&#47;&#47;evil.example)", "[x](%2F%2Fevil.example)",
            "http&colon;//x.example", "&lt;script&gt;alert(1)&lt;/script&gt;", "&#60;iframe src=x&#62;", "&amp;#104;ttp://x",
            "%2568ttp://x.example", "java\tscript:alert(1)", "java&Tab;script:alert(1)", "ht\ntp://x.example", "java&#10;script:x",
            "&#x3C;img src=x &#111;nerror=alert(1)>",
        ];
        for markdown in bad {
            assert!(parse_insert(markdown).is_err(), "{markdown:?} should be rejected");
        }
    }

    #[test]
    fn rejects_each_tag_and_scheme_individually() {
        // Any `<` followed by a letter is raw HTML now; the old tag list is only a subset of that.
        for tag in ["script", "iframe", "object", "embed", "link", "meta", "style", "base", "form", "b", "img", "svg", "a", "div"] {
            for text in [format!("<{tag}>"), format!("<{} x=1>", tag.to_uppercase()), format!("</{tag}>"), format!("< {tag}>")] {
                assert!(parse_insert(&text).is_err(), "{text:?} should be rejected");
            }
        }
        for scheme in URL_SCHEMES {
            for text in [format!("{scheme}:x"), format!("[a]({}:x)", scheme.to_uppercase()), format!("[a]: {scheme} :x")] {
                assert!(parse_insert(&text).is_err(), "{text:?} should be rejected");
            }
        }
        for text in ["[a](mailto:x@y.z)", "[a](tel:+1)", "[a](c:/x.png)", "[a](/abs.png)", "[a](a:b)", "www.x.com", "//host.example/a.png"] {
            assert!(parse_insert(text).is_err(), "{text:?} should be rejected");
        }
    }

    #[test]
    fn rejects_the_verified_bypasses() {
        for text in [
            "<img src=\"&#0000000104;ttp://evil.example/p.png\">",
            "![x](&#0000000104;ttp://evil.example/p.png)",
            "<a href=\"&#0000000104;ttp://evil.example/x\">x</a>",
            "&#0000000047;&#0000000047;evil.example/p.png",
            "<img src=\" //evil.example/p.png\">",
            "<img src=\"&#32;//evil.example/p.png\">",
        ] {
            assert!(parse_insert(text).is_err(), "{text:?} should be rejected");
        }
    }

    fn corpus(key: &str) -> Vec<String> {
        let corpus: serde_json::Value = serde_json::from_str(include_str!("../../src/lib/fixtures/insert-corpus.json")).unwrap();
        corpus[key].as_array().unwrap().iter().map(|entry| entry.as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn the_shared_corpus_has_the_expected_verdicts() {
        let (accept, reject) = (corpus("accept"), corpus("reject"));
        assert!(accept.len() >= 40 && reject.len() >= 120, "{} accept, {} reject", accept.len(), reject.len());
        for text in &accept {
            assert!(parse_insert(text).is_ok(), "{text:?} should be accepted: {:?}", parse_insert(text).err());
        }
        for text in &reject {
            assert!(parse_insert(text).is_err(), "{text:?} should be rejected");
        }
    }

    #[test]
    fn adversarial_inputs_are_checked_quickly() {
        let mut inputs: Vec<String> = ["&", "[", "(", "<", "](", "](<", "&#", "%", "\\", "//", "www.", "< ", "h t t p ", "[a]:
", "&amp;", "'", "\""]
            .iter()
            .map(|unit| unit.repeat(MAX_INSERT_MARKDOWN_CHARS / unit.chars().count()))
            .collect();
        inputs.push(format!("&{}", "amp;".repeat(2000)));
        inputs.push(format!("{}{}", "&#".repeat(2000), "0".repeat(4000)));
        inputs.push(format!("{}{}", "[x](".repeat(1000), ")".repeat(4000)));
        inputs.push("%25".repeat(2730));
        inputs.push(format!("[a]({}", "(".repeat(8000)));
        for text in inputs {
            let text: String = text.chars().take(MAX_INSERT_MARKDOWN_CHARS).collect();
            let started = std::time::Instant::now();
            let _ = parse_insert(&text);
            let elapsed = started.elapsed();
            assert!(elapsed < std::time::Duration::from_millis(100), "{:?}... took {elapsed:?}", text.chars().take(12).collect::<String>());
        }
    }

    #[test]
    fn rejects_markdown_outside_the_length_and_character_limits() {
        assert!(parse_insert("").is_err());
        assert!(parse_insert(&"x".repeat(MAX_INSERT_MARKDOWN_CHARS + 1)).is_err());
        for bad in [
            "a\u{0}b", "a\u{1B}b", "a\u{7}b", "a\u{85}b", "zero\u{200B}width", "joiner\u{200D}x", "bidi\u{202E}text", "isolate\u{2066}x",
            "bom\u{FEFF}x", "word\u{2060}joiner",
        ] {
            assert!(parse_insert(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn an_action_needs_sdk_2_the_permission_and_exactly_one_kind_of_control() {
        let ok = insert_item("Hi");
        assert!(parse_manifest(&action_manifest(ok.clone(), 2, &["editor:insert"])).is_ok());
        assert!(parse_manifest(&action_manifest(ok.clone(), 1, &["editor:insert"])).is_err(), "sdk 1");
        assert!(parse_manifest(&action_manifest(ok.clone(), 2, &[])).is_err(), "no permission");
        assert!(parse_manifest(&action_manifest(ok.clone(), 2, &["editor:zoom:read"])).is_err(), "wrong permission");

        let with = |key: &str, value: serde_json::Value| {
            let mut item = ok.clone();
            item[key] = value;
            parse_manifest(&action_manifest(item, 2, &["editor:insert", "editor:zoom:write"]))
        };
        assert!(with("command", "go".into()).is_err(), "action + command");
        assert!(with("bind", "zoom".into()).is_err(), "action + bind");
        assert!(with("options", serde_json::json!([{ "value": "1", "label": "One" }])).is_err(), "action + options");
        assert!(with("type", "toggle".into()).is_err(), "action on a toggle");
        assert!(with("type", "select".into()).is_err(), "action on a select");
        assert!(with("slot", "preview".into()).is_err(), "action in the preview slot");
        assert!(with("slot", "main".into()).is_ok());
        assert!(with("when", "markdown".into()).is_ok());
        assert!(with("when", "always".into()).is_err());

        let mut other_type = ok.clone();
        other_type["action"]["type"] = "runCommand".into();
        assert!(parse_manifest(&action_manifest(other_type, 2, &["editor:insert"])).is_err());
        let mut extra = ok.clone();
        extra["action"]["code"] = "x".into();
        assert!(parse_manifest(&action_manifest(extra, 2, &["editor:insert"])).is_err(), "unknown action field");
        let mut missing = ok;
        missing["action"].as_object_mut().unwrap().remove("markdown");
        assert!(parse_manifest(&action_manifest(missing, 2, &["editor:insert"])).is_err(), "missing markdown");
    }

    #[test]
    fn a_plugin_may_declare_sixteen_action_buttons_but_not_seventeen() {
        let build = |count: usize| {
            let items: Vec<serde_json::Value> = (1..=count)
                .map(|n| serde_json::json!({ "id": format!("insert-{n}"), "type": "button", "label": format!("B{n}"), "action": { "type": "insertMarkdown", "markdown": "x" } }))
                .collect();
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1, "sdkVersion": 2, "id": "custom.many", "name": "Many", "version": "1.0.0", "author": "Me",
                "description": "d", "main": "dist/index.js", "permissions": ["editor:insert"], "contributions": { "toolbar": items }
            }))
            .unwrap()
        };
        assert!(parse_manifest(&build(16)).is_ok());
        assert!(parse_manifest(&build(17)).is_err());
    }
}
