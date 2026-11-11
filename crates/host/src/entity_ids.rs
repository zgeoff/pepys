//! The entity ID `<source>:<kind>:<id>`, by the rule of the kit's `parseEntityID`: the source and
//! the kind are lowercase names, the source is no fact kind, and the ID is not empty. The ID may
//! hold colons.

pub const FACT_KINDS: [&str; 5] = ["webhook", "event", "observation", "enrichment", "manual"];

/// The `<source>:<kind>` of an entity ID, or `None` for text that is no entity ID.
#[must_use]
pub fn kind_of(text: &str) -> Option<&str> {
    let mut parts = text.splitn(3, ':');
    let (source, kind, id) = (parts.next()?, parts.next()?, parts.next()?);

    if !is_name_part(source) || FACT_KINDS.contains(&source) || !is_name_part(kind) || id.is_empty()
    {
        return None;
    }

    text.get(..source.len() + 1 + kind.len())
}

/// Lowercase letters, digits and `_`, starting with a letter.
#[must_use]
pub fn is_name_part(text: &str) -> bool {
    let mut bytes = text.bytes();

    bytes.next().is_some_and(|first| first.is_ascii_lowercase())
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_gives_the_source_and_kind_of_an_id_whose_last_part_holds_colons() {
        assert_eq!(kind_of("archive:box:b:1"), Some("archive:box"));
    }

    #[test]
    fn it_gives_no_kind_for_an_id_whose_source_is_a_fact_kind() {
        assert_eq!(kind_of("event:archive:e-1"), None);
    }
}
