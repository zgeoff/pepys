//! The envelope check an append runs, the same check the TypeScript adapters run before an append.

use serde_json::{Map, Value};

const FIELDS: [&str; 9] = [
    "id", "type", "v", "api", "entity", "actor", "at", "cursor", "payload",
];
const FACT_KINDS: [&str; 4] = ["webhook", "observation", "enrichment", "manual"];

/// Whether `body` is a fact envelope: a JSON object with the envelope's fields and no others.
pub fn is_fact_envelope(body: &str) -> bool {
    let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(body) else {
        return false;
    };

    fields.keys().all(|key| FIELDS.contains(&key.as_str()))
        && text_field(&fields, "id").is_some_and(is_fact_id)
        && text_field(&fields, "type").is_some_and(|text| !text.is_empty())
        && fields.get("v").and_then(Value::as_f64) == Some(1.0)
        && text_field(&fields, "api").is_some_and(|text| !text.is_empty())
        && text_field(&fields, "entity").is_some_and(is_entity_id)
        && fields
            .get("actor")
            .is_none_or(|actor| actor.as_str().is_some_and(is_entity_id))
        && text_field(&fields, "at").is_some_and(is_utc_datetime)
        && fields.get("cursor").is_none_or(Value::is_string)
        && fields.contains_key("payload")
}

fn text_field<'a>(fields: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    fields.get(name).and_then(Value::as_str)
}

fn is_fact_id(text: &str) -> bool {
    if let Some(rest) = text.strip_prefix("webhook:") {
        return rest
            .split_once(':')
            .is_some_and(|(source, id)| is_name_part(source) && is_one_line(id));
    }

    ["observation:", "enrichment:", "manual:"]
        .iter()
        .any(|prefix| {
            text.strip_prefix(prefix).is_some_and(|hash| {
                hash.len() == 64
                    && hash
                        .bytes()
                        .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
            })
        })
}

/// Not empty, and free of the characters that end a line for `.` in a JavaScript pattern.
fn is_one_line(text: &str) -> bool {
    !text.is_empty() && !text.contains(['\n', '\r', '\u{2028}', '\u{2029}'])
}

fn is_entity_id(text: &str) -> bool {
    let mut parts = text.splitn(3, ':');

    let (Some(source), Some(kind), Some(id)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };

    is_name_part(source) && !FACT_KINDS.contains(&source) && is_name_part(kind) && !id.is_empty()
}

/// Lowercase letters, digits and `_`, starting with a letter.
fn is_name_part(text: &str) -> bool {
    let mut bytes = text.bytes();

    bytes.next().is_some_and(|first| first.is_ascii_lowercase())
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

/// `YYYY-MM-DDTHH:MM:SS` with optional fractional seconds and a `Z`, on a day the calendar has.
fn is_utc_datetime(text: &str) -> bool {
    let Some(stamp) = text.strip_suffix('Z') else {
        return false;
    };
    let (whole, fraction) = stamp.split_once('.').unwrap_or((stamp, "0"));
    let bytes = whole.as_bytes();
    let is_shaped = bytes.len() == 19
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            10 => *byte == b'T',
            13 | 16 => *byte == b':',
            _ => byte.is_ascii_digit(),
        });

    if !is_shaped || fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }

    let number = |range: std::ops::Range<usize>| whole[range].parse::<u32>().unwrap_or(u32::MAX);
    let (year, month, day) = (number(0..4), number(5..7), number(8..10));

    (1..=days_in_month(year, month)).contains(&day)
        && number(11..13) < 24
        && number(14..16) < 60
        && number(17..19) < 60
}

fn days_in_month(year: u32, month: u32) -> u32 {
    let is_leap = (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400);

    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap => 29,
        2 => 28,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope_with(field: &str, value: &str) -> String {
        let mut envelope = serde_json::json!({
            "id": "webhook:github:d-1",
            "type": "github.pull_request.opened",
            "v": 1,
            "api": "github/2022-11-28",
            "entity": "github:pr:77",
            "at": "2026-10-02T10:30:00Z",
            "payload": {}
        });

        envelope[field] = serde_json::from_str(value).unwrap_or(Value::Null);

        envelope.to_string()
    }

    #[test]
    fn it_accepts_each_kind_of_fact_id() {
        let ids = [
            r#""webhook:github:d-1""#,
            &format!(r#""observation:{}""#, "0a".repeat(32)),
            &format!(r#""enrichment:{}""#, "b1".repeat(32)),
            &format!(r#""manual:{}""#, "c2".repeat(32)),
        ];

        let accepted: Vec<bool> = ids
            .iter()
            .map(|id| is_fact_envelope(&envelope_with("id", id)))
            .collect();

        assert_eq!(accepted, vec![true; 4]);
    }

    #[test]
    fn it_refuses_each_field_the_envelope_parse_refuses() {
        let refused = [
            ("id", r#""not-a-fact-id""#),
            ("id", r#""manual:abc""#),
            ("id", r#""webhook:GitHub:d-1""#),
            ("id", r#""webhook:github:d\n1""#),
            ("id", r#""webhook:github:d\r1""#),
            ("id", r#""webhook:github:d\u20281""#),
            ("id", r#""webhook:github:d\u20291""#),
            ("type", r#""""#),
            ("v", "2"),
            ("api", "7"),
            ("entity", r#""github:pr""#),
            ("entity", r#""manual:pr:7""#),
            ("actor", r#""github:7""#),
            ("at", r#""2026-10-02T10:30Z""#),
            ("at", r#""2026-10-02T10:30:00+01:00""#),
            ("at", r#""2026-02-30T10:30:00Z""#),
            ("at", r#""2026-10-02T24:00:00Z""#),
            ("cursor", "3"),
            ("extra", "1"),
        ];

        let accepted: Vec<(&str, &str)> = refused
            .iter()
            .filter(|(field, value)| is_fact_envelope(&envelope_with(field, value)))
            .copied()
            .collect();

        assert_eq!(accepted, Vec::<(&str, &str)>::new());
    }

    #[test]
    fn it_accepts_fractional_seconds_and_a_leap_day() {
        let accepted = [
            is_fact_envelope(&envelope_with("at", r#""2026-10-02T10:30:00.123456Z""#)),
            is_fact_envelope(&envelope_with("at", r#""2028-02-29T10:30:00Z""#)),
        ];

        assert_eq!(accepted, [true, true]);
    }

    #[test]
    fn it_refuses_an_envelope_without_a_payload() {
        let body = r#"{"id":"webhook:github:d-1","type":"t","v":1,"api":"a","entity":"github:pr:7","at":"2026-10-02T10:30:00Z"}"#;

        assert!(!is_fact_envelope(body));
    }
}
